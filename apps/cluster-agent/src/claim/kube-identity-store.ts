/**
 * Kubernetes-Secret-backed {@link IdentityStore} (FR1/FR6).
 *
 * The standalone chart runs the container with `readOnlyRootFilesystem` and
 * mounts the identity Secret read-only, so a file write can never persist the
 * registered `{id, token}` — on first boot the mount path does not even exist
 * (the Secret is `optional` and absent until someone creates it). Persistence
 * goes through the Kubernetes API instead: `save` creates or patches the ONE
 * named Secret the `lore-cluster-agent-identity` Role grants, and `load` reads
 * it back through the same API — no volume-projection delay, no writable
 * filesystem needed. `FileIdentityStore` stays for local (non-cluster) runs.
 *
 * The decision logic is pure over {@link IdentitySecretsApi}; the thin
 * CoreV1Api shell lives in {@link kubeIdentitySecretsApi}.
 */

import type { ClusterAgentIdentity, IdentityStore } from "./identity-store.js";

/** The minimal Secret surface the store drives — injectable for tests. */
export interface IdentitySecretsApi {
  /** The Secret's decoded `data`, or null when it does not exist. */
  read(name: string): Promise<Record<string, string> | null>;
  create(name: string, stringData: Record<string, string>): Promise<void>;
  patch(name: string, stringData: Record<string, string>): Promise<void>;
}

export class KubeIdentityStore implements IdentityStore {
  constructor(
    private readonly api: IdentitySecretsApi,
    private readonly secretName: string,
    private readonly fileName: string,
  ) {}

  async load(): Promise<ClusterAgentIdentity | null> {
    const data = await this.api.read(this.secretName);
    const raw = data?.[this.fileName];

    if (!raw) {
      return null; // no Secret yet — first boot
    }

    try {
      const parsed = JSON.parse(raw) as Partial<ClusterAgentIdentity>;

      if (typeof parsed.id !== "string" || typeof parsed.token !== "string") {
        return null;
      }

      return { id: parsed.id, token: parsed.token };
    } catch (err) {
      // Corrupt data is a fresh start, not a crash — same contract as the
      // file store: registration 409s loudly if the name is taken.
      console.warn(
        `[cluster-agent] identity secret ${this.secretName} is unreadable (${err instanceof Error ? err.message : String(err)}) — treating as unregistered`,
      );

      return null;
    }
  }

  async save(identity: ClusterAgentIdentity): Promise<void> {
    const stringData = { [this.fileName]: JSON.stringify(identity) };

    if ((await this.api.read(this.secretName)) === null) {
      await this.api.create(this.secretName, stringData);

      return;
    }

    await this.api.patch(this.secretName, stringData);
  }
}

interface KubeStatusError {
  code?: number;
  statusCode?: number;
  response?: { statusCode?: number };
}

const isNotFound = (err: unknown): boolean => {
  const e = err as KubeStatusError;

  return (
    e.code === 404 || e.statusCode === 404 || e.response?.statusCode === 404
  );
};

/** The CoreV1Api shell — the only part that touches the cluster. */
export async function kubeIdentitySecretsApi(
  namespace: string,
): Promise<IdentitySecretsApi> {
  const { KubeConfig, CoreV1Api } = await import("@kubernetes/client-node");
  const { loadKube } = await import("@re-cinq/lore-shared");
  const kc = new KubeConfig();

  loadKube(kc);
  const core = kc.makeApiClient(CoreV1Api);

  return {
    async read(name) {
      try {
        const secret = await core.readNamespacedSecret({ name, namespace });
        const decoded: Record<string, string> = {};

        for (const [key, value] of Object.entries(secret.data ?? {})) {
          decoded[key] = Buffer.from(value, "base64").toString("utf8");
        }

        return decoded;
      } catch (err) {
        if (isNotFound(err)) {
          return null;
        }
        throw err;
      }
    },
    async create(name, stringData) {
      await core.createNamespacedSecret({
        namespace,
        body: { metadata: { name }, stringData },
      });
    },
    async patch(name, stringData) {
      // Read-replace (the kube-token-provisioner idiom): the identity has a
      // single writer, so no optimistic-concurrency retry loop is needed.
      const current = await core.readNamespacedSecret({ name, namespace });

      current.stringData = stringData;
      await core.replaceNamespacedSecret({ name, namespace, body: current });
    },
  };
}
