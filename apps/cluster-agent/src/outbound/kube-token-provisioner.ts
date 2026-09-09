// Per-task token provisioning IO (ADR-031 D6, #697) — orchestrates mint→PATCH→materialise-triple via three injected ports; pure transforms live in per-task-token.ts, this is the IO shell.

import { isConflict } from "../lib/k8s-errors.js";
import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import {
  agentsNamespace,
  errorMessage,
  type LoreTaskSpec,
} from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { TokenProvisioner } from "@re-cinq/lore-shared";
import {
  tokenSecretKey,
  perTaskName,
  catalogLookupName,
  injectRepoToken,
  perTaskStation,
} from "@re-cinq/lore-shared";

import { coreApi } from "./kube-clients.js";

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

/** Reclaims the same triple `cleanup(taskId)` does, but WARNS per failure — unlike cleanup's silent allSettled, a token stranded here is a live credential nobody will ever use. */
interface ReclaimPorts {
  secretName: string;
  secrets: { deleteKey: (secret: string, key: string) => Promise<void> };
  catalog: {
    deleteStation: (name: string) => Promise<void>;
    deleteAgentDefinition: (name: string) => Promise<void>;
  };
}

async function reclaimProvision(
  ports: ReclaimPorts,
  ref: { key: string; name: string },
): Promise<void> {
  const reclaim = reclaimTriple(ports, ref);

  warnUnreclaimed(
    reclaim.map(([label]) => label),
    await Promise.allSettled(reclaim.map(([, p]) => p)),
  );
}

// The three things a provision creates, each paired with its label. Attempted together rather than in sequence: one failing must not stop the other two being reclaimed.
function reclaimTriple(
  ports: ReclaimPorts,
  ref: { key: string; name: string },
): Array<[string, Promise<void>]> {
  return [
    [ref.key, ports.secrets.deleteKey(ports.secretName, ref.key)],
    [ref.name, ports.catalog.deleteStation(ref.name)],
    [ref.name, ports.catalog.deleteAgentDefinition(ref.name)],
  ];
}

// Names each thing the reclaim could not remove. WARNED individually — unlike cleanup's silent allSettled, a token stranded here is a live credential nobody will ever use.
function warnUnreclaimed(
  labels: string[],
  settled: PromiseSettledResult<void>[],
): void {
  settled.forEach((result, i) => {
    if (result.status === "rejected") {
      console.warn(
        `[cluster-agent] could not reclaim ${labels[i]} after a failed provision: ${errorMessage(result.reason)}`,
      );
    }
  });
}

export class KubeTokenProvisioner implements TokenProvisioner, TokenCleanup {
  constructor(
    private readonly minter: TokenMinter,
    private readonly secrets: SecretKeyWriter,
    private readonly catalog: CatalogApi,
    private readonly secretName = process.env.LORE_AGENT_SECRETS_NAME ??
      "agent-secrets",
  ) {}

  /** Station FIRST, the same invariant applyCatalogPair holds: writing the AgentDefinition last means it is never visible pointing at a Station that does not exist yet. */
  private async writePair(input: {
    catalogStation: Parameters<typeof perTaskStation>[0];
    catalogDef: Parameters<typeof injectRepoToken>[0];
    spec: LoreTaskSpec;
    key: string;
    name: string;
  }): Promise<void> {
    const { catalogStation, catalogDef, spec, key, name } = input;

    await this.catalog.applyStation(
      perTaskStation(catalogStation, name, name, spec.taskId),
    );
    await this.catalog.applyAgentDefinition(
      injectRepoToken(catalogDef, spec, key, name),
    );
  }

  /** Mints the run's repo token into `agent-secrets` and returns the key it landed under. */
  private async mintToken(spec: LoreTaskSpec): Promise<string> {
    const key = tokenSecretKey(spec.taskId);

    await this.secrets.setKey(
      this.secretName,
      key,
      await this.minter.mint(spec.targetRepo),
    );

    return key;
  }

  // Undoes a half-finished provision. A token minted but never paired with a recipe is a live credential nobody will use, so the failure path removes all three before rethrowing.
  private async reclaim(ref: { key: string; name: string }): Promise<void> {
    await reclaimProvision(
      {
        secretName: this.secretName,
        secrets: this.secrets,
        catalog: this.catalog,
      },
      ref,
    );
  }

  // The recipe and its station, or null when either is missing. BOTH reads, one wait — neither depends on the other, and this sits between "claim returned" and "CR exists", where every extra round trip is time the claimed visit is not running.
  private async catalogPair(spec: LoreTaskSpec) {
    const lookup = catalogLookupName(spec);
    const [catalogDef, catalogStation] = await Promise.all([
      this.catalog.getAgentDefinition(lookup),
      this.catalog.getStation(lookup),
    ]);

    return catalogDef && catalogStation ? { catalogDef, catalogStation } : null;
  }

  async provision(spec: LoreTaskSpec): Promise<string | undefined> {
    const pair = await this.catalogPair(spec);

    if (!pair) {
      return undefined;
    }
    const { catalogDef, catalogStation } = pair;
    const key = await this.mintToken(spec);
    const name = perTaskName(spec.taskId);

    try {
      await this.writePair({ catalogStation, catalogDef, spec, key, name });

      return name;
    } catch (err) {
      await this.reclaim({ key, name });
      throw err;
    }

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

/** The org App installation token; per-repo least-privilege scoping is a follow-up — the repo arg is accepted now so the port is stable when it lands. */
export class GithubTokenMinter implements TokenMinter {
  constructor(
    private readonly gh: { getInstallationToken(): Promise<string> },
  ) {}
  async mint(repo: string): Promise<string> {
    const token = await this.gh.getInstallationToken();

    // An empty token writes a present-but-useless Secret key, so the pod dies in its init container on `git clone` with an uninformative "Repository not found". Fail here instead, where the cause is legible.
    enforceTrue(
      token.length > 0,
      Error,
      `minted an empty GitHub token for ${repo} — check GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID`,
    );

    return token;
  }
}

/** The two Secret calls the writer makes; `metadata` is part of the shape on purpose — the apiserver decides the optimistic-concurrency race on the `resourceVersion` inside it. */
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
export type SecretClientFactory = () => SecretClient;

export class KubeSecretKeyWriter implements SecretKeyWriter {
  /** Injectable so the conflict ladder (dark through the 2026-08-25 race, its classifier once in a private copy) can be driven without a cluster. */
  constructor(
    private readonly namespace = agentsNamespace(),
    private readonly core: SecretClientFactory = coreApi,
  ) {}

  setKey(secret: string, key: string, value: string): Promise<void> {
    return this.mutate(secret, (entries) => {
      entries[key] = Buffer.from(value, "utf8").toString("base64");
    });
  }

  deleteKey(secret: string, key: string): Promise<void> {
    return this.mutate(secret, (entries) => {
      delete entries[key];
    });
  }

  // One read-modify-replace. Rereads every time it is called, which is the point: a concurrent provision bumps resourceVersion, the replace 409s, and retrying against a stale copy would drop whichever key the other writer had just added.
  private async mutateOnce(
    secret: string,
    change: (data: Record<string, string>) => void,
  ): Promise<void> {
    const core = this.core();
    const current = await core.readNamespacedSecret({
      name: secret,
      namespace: this.namespace,
    });
    const entries = (current.data ?? {}) as Record<string, string>;

    change(entries);
    current.data = entries;

    await core.replaceNamespacedSecret({
      name: secret,
      namespace: this.namespace,
      body: current,
    });
  }

  // Read-modify-replace under optimistic concurrency: a concurrent provision bumps resourceVersion, replace 409s, and we retry the read so no key is lost.
  private async mutate(
    secret: string,
    change: (data: Record<string, string>) => void,
  ): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.mutateOnce(secret, change);

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
