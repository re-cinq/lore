// Kubernetes-Secret-backed IdentityStore (FR1/FR6): the standalone chart mounts the identity Secret read-only, so save/load go through the Kubernetes API instead of a file write.

import { parseIdentity } from "./identity-store.js";
import type { ClusterAgentIdentity, IdentityStore } from "./identity-store.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { isNotFound } from "../kernel/k8s-errors.js";
import { coreApi } from "../kernel/kube-clients.js";

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
    const secret = await this.api.read(this.secretName);
    const raw = secret?.[this.fileName];

    if (!raw) {
      return null; // no Secret yet — first boot
    }

    try {
      return parseIdentity(raw);
    } catch (err) {
      // Corrupt secret is a fresh start, not a crash — same contract as the file store.
      console.warn(
        `[cluster-agent] identity secret ${this.secretName} is unreadable (${errorMessage(err)}) — treating as unregistered`,
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

/** The CoreV1Api shell — the only part that touches the cluster. */
export function kubeIdentitySecretsApi(namespace: string): IdentitySecretsApi {
  const core = coreApi();

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
      // Read-replace (kube-token-provisioner idiom) — single writer, so no optimistic-concurrency retry needed.
      const current = await core.readNamespacedSecret({ name, namespace });

      current.stringData = stringData;
      await core.replaceNamespacedSecret({ name, namespace, body: current });
    },
  };
}
