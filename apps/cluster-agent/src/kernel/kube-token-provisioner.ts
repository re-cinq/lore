// Per-task token provisioning IO (ADR-031 D6, #697). Orchestrates the mint → PATCH →
// materialise-triple flow using three injected ports, each wrapping one external system
// (Octokit, the Kubernetes Secret, the Kubernetes custom objects). The pure transforms
// it composes live in per-task-token.ts; this file is the IO shell (not in the coverage
// allowlist). All Kubernetes calls use the object-param client (like k8s-loretask.ts).

import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import {
  agentsNamespace,
  loadKube,
  type LoreTaskSpec,
} from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { TokenProvisioner } from "@re-cinq/lore-shared";
import { isConflict, isNotFound } from "./k8s-errors.js";
import {
  tokenSecretKey,
  perTaskName,
  catalogLookupName,
  injectRepoToken,
  perTaskStation,
} from "@re-cinq/lore-shared";

const GROUP = "agents.re-cinq.com";
const VERSION = "v1alpha1";
const DEF_PLURAL = "agentdefinitions";
const STATION_PLURAL = "stations";

/** Mints a short-lived git token for a repo. */
export interface TokenMinter {
  mint(repo: string): Promise<string>;
}

/** Adds/removes a single key in a Kubernetes Secret without disturbing other keys. */
export interface SecretKeyWriter {
  setKey(secret: string, key: string, value: string): Promise<void>;
  deleteKey(secret: string, key: string): Promise<void>;
}

/** Reads catalog recipes and applies/deletes the per-task ones. */
export interface CatalogApi {
  getAgentDefinition(name: string): Promise<AgentDefinition | null>;
  getStation(name: string): Promise<Station | null>;
  applyAgentDefinition(def: AgentDefinition): Promise<void>;
  applyStation(station: Station): Promise<void>;
  deleteAgentDefinition(name: string): Promise<void>;
  deleteStation(name: string): Promise<void>;
}

/** Removes the per-task token key + triple once the task is terminal. */
export interface TokenCleanup {
  cleanup(taskId: string): Promise<void>;
}

export class KubeTokenProvisioner implements TokenProvisioner, TokenCleanup {
  constructor(
    private readonly minter: TokenMinter,
    private readonly secrets: SecretKeyWriter,
    private readonly catalog: CatalogApi,
    private readonly secretName = process.env.LORE_AGENT_SECRETS_NAME ??
      "agent-secrets",
  ) {}

  async provision(spec: LoreTaskSpec): Promise<string | undefined> {
    const lookup = catalogLookupName(spec);
    const catalogDef = await this.catalog.getAgentDefinition(lookup);
    const catalogStation = await this.catalog.getStation(lookup);

    if (!catalogDef || !catalogStation) {
      return undefined;
    }

    const key = tokenSecretKey(spec.taskId);

    await this.secrets.setKey(
      this.secretName,
      key,
      await this.minter.mint(spec.targetRepo),
    );

    const name = perTaskName(spec.taskId);

    await this.catalog.applyAgentDefinition(
      injectRepoToken(catalogDef, spec, key, name),
    );
    await this.catalog.applyStation(
      perTaskStation(catalogStation, name, name, spec.taskId),
    );

    return name;
  }

  async cleanup(taskId: string): Promise<void> {
    const name = perTaskName(taskId);

    await Promise.allSettled([
      this.secrets.deleteKey(this.secretName, tokenSecretKey(taskId)),
      this.catalog.deleteStation(name),
      this.catalog.deleteAgentDefinition(name),
    ]);
  }
}

/** The org App installation token (apps/floor/src/adapters/github.ts). Per-repo
 *  least-privilege scoping is a follow-up — the repo arg is accepted now so the port
 *  is stable when scoping lands. */
export class GithubTokenMinter implements TokenMinter {
  constructor(
    private readonly gh: { getInstallationToken(): Promise<string> },
  ) {}
  async mint(repo: string): Promise<string> {
    const token = await this.gh.getInstallationToken();

    // An empty token writes a present-but-useless Secret key, so the pod starts and
    // then dies in its init container on `git clone` with GitHub's deliberately
    // uninformative "Repository not found". Fail here, where the cause is legible.
    enforceTrue(
      token.length > 0,
      Error,
      `minted an empty GitHub token for ${repo} — check GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID`,
    );

    return token;
  }
}

/**
 * The two Secret calls the writer makes; a test fakes exactly this.
 *
 * `metadata` is part of the shape on purpose. The replace below sends the object
 * it just read straight back, and the apiserver decides the optimistic-
 * concurrency race on the `resourceVersion` inside it — so a fake that cannot
 * carry one cannot express the very collision this writer's retry exists for.
 */
export interface SecretMutation {
  metadata?: { resourceVersion?: string };
  data?: Record<string, string>;
}

export interface SecretClient {
  readNamespacedSecret(args: {
    name: string;
    namespace: string;
  }): Promise<SecretMutation>;
  replaceNamespacedSecret(args: {
    name: string;
    namespace: string;
    body: SecretMutation;
  }): Promise<unknown>;
}
export type SecretClientFactory = () => Promise<SecretClient>;

const kubeSecretClient: SecretClientFactory = async () => {
  const { KubeConfig, CoreV1Api: Api } =
    await import("@kubernetes/client-node");
  const kc = new KubeConfig();

  loadKube(kc);

  return kc.makeApiClient(Api);
};

export class KubeSecretKeyWriter implements SecretKeyWriter {
  /** Injectable so the conflict ladder below — the one that stayed dark
   *  through the 2026-08-25 race because its classifier lived in a private
   *  copy — can be driven without a cluster. */
  constructor(
    private readonly namespace = agentsNamespace(),
    private readonly core: SecretClientFactory = kubeSecretClient,
  ) {}

  setKey(secret: string, key: string, value: string): Promise<void> {
    return this.mutate(secret, (data) => {
      data[key] = Buffer.from(value, "utf8").toString("base64");
    });
  }

  deleteKey(secret: string, key: string): Promise<void> {
    return this.mutate(secret, (data) => {
      delete data[key];
    });
  }

  // Read-modify-replace under optimistic concurrency: a concurrent provision bumps the
  // resourceVersion, replace 409s, and we retry the read so no key is lost.
  private async mutate(
    secret: string,
    change: (data: Record<string, string>) => void,
  ): Promise<void> {
    const core = await this.core();

    for (let attempt = 0; ; attempt++) {
      const current = await core.readNamespacedSecret({
        name: secret,
        namespace: this.namespace,
      });
      const data = (current.data ?? {}) as Record<string, string>;

      change(data);
      current.data = data;

      try {
        await core.replaceNamespacedSecret({
          name: secret,
          namespace: this.namespace,
          body: current,
        });

        return;
      } catch (err) {
        if (isConflict(err) && attempt < 4) {
          continue;
        }
        throw err;
      }
    }
  }
}

export class KubeCatalogApi implements CatalogApi {
  constructor(private readonly namespace = agentsNamespace()) {}

  private async api() {
    const { KubeConfig, CustomObjectsApi } =
      await import("@kubernetes/client-node");
    const kc = new KubeConfig();

    loadKube(kc);

    return kc.makeApiClient(CustomObjectsApi);
  }

  getAgentDefinition(name: string): Promise<AgentDefinition | null> {
    return this.get<AgentDefinition>(DEF_PLURAL, name);
  }
  getStation(name: string): Promise<Station | null> {
    return this.get<Station>(STATION_PLURAL, name);
  }
  applyAgentDefinition(def: AgentDefinition): Promise<void> {
    return this.apply(DEF_PLURAL, def.metadata?.name ?? "", def);
  }
  applyStation(station: Station): Promise<void> {
    return this.apply(STATION_PLURAL, station.metadata?.name ?? "", station);
  }
  deleteAgentDefinition(name: string): Promise<void> {
    return this.del(DEF_PLURAL, name);
  }
  deleteStation(name: string): Promise<void> {
    return this.del(STATION_PLURAL, name);
  }

  private async get<T>(plural: string, name: string): Promise<T | null> {
    const api = await this.api();

    try {
      return (await api.getNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace: this.namespace,
        plural,
        name,
      })) as T;
    } catch (err) {
      if (isNotFound(err)) {
        return null;
      }
      throw err;
    }
  }

  // Create, or replace (carrying the live resourceVersion) when it already exists.
  private async apply(
    plural: string,
    name: string,
    body: object,
  ): Promise<void> {
    const api = await this.api();

    try {
      await api.createNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace: this.namespace,
        plural,
        body,
      });
    } catch (err) {
      if (!isConflict(err)) {
        throw err;
      }
      const current = (await api.getNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace: this.namespace,
        plural,
        name,
      })) as { metadata?: { resourceVersion?: string } };
      const meta =
        (body as { metadata?: Record<string, unknown> }).metadata ?? {};

      await api.replaceNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace: this.namespace,
        plural,
        name,
        body: {
          ...body,
          metadata: {
            ...meta,
            resourceVersion: current.metadata?.resourceVersion,
          },
        },
      });
    }
  }

  private async del(plural: string, name: string): Promise<void> {
    const api = await this.api();

    try {
      await api.deleteNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace: this.namespace,
        plural,
        name,
      });
    } catch (err) {
      if (!isNotFound(err)) {
        throw err;
      }
    }
  }
}
