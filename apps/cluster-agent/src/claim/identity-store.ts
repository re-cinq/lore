// The cluster-agent's registered {id, token} identity, returned exactly once by register — persisted outside the process since losing it 409s (FR6, standalone satellite chart mounts a Secret; $HOME path serves local runs meanwhile).

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

export interface ClusterAgentIdentity {
  id: string;
  token: string;
}

export interface IdentityStore {
  load(): Promise<ClusterAgentIdentity | null>;
  save(identity: ClusterAgentIdentity): Promise<void>;
}

/** Where the identity persists — decided at boot so a half-configured Secret store refuses to start instead of idling behind a green /healthz. */
export type IdentityStoreConfig =
  | { kind: "file"; path: string }
  | { kind: "secret"; name: string; namespace: string; key: string };

export function identityStoreConfig(
  env: NodeJS.ProcessEnv,
): IdentityStoreConfig {
  const name = env.LORE_CLUSTER_AGENT_IDENTITY_SECRET;

  if (!name) {
    return { kind: "file", path: identityFilePath(env) };
  }
  const namespace = env.LORE_CLUSTER_AGENT_IDENTITY_NAMESPACE;

  enforceTrue(
    namespace,
    Error,
    "cluster-agent cannot start: LORE_CLUSTER_AGENT_IDENTITY_SECRET is set but LORE_CLUSTER_AGENT_IDENTITY_NAMESPACE is not — the identity Secret needs a namespace",
  );

  return {
    kind: "secret",
    name,
    namespace,
    key: env.LORE_CLUSTER_AGENT_IDENTITY_KEY ?? "identity.json",
  };
}

export function identityFilePath(env: NodeJS.ProcessEnv): string {
  return (
    env.LORE_CLUSTER_AGENT_IDENTITY_FILE ??
    path.join(env.HOME ?? os.homedir(), ".lore", "cluster-agent-identity.json")
  );
}

/** Read a stored identity, or null when it is not one. Shared by both stores so the parse check never drifts between them. */
export function parseIdentity(raw: string): ClusterAgentIdentity | null {
  const parsed = JSON.parse(raw) as Partial<ClusterAgentIdentity>;

  if (typeof parsed.id !== "string" || typeof parsed.token !== "string") {
    return null;
  }

  return { id: parsed.id, token: parsed.token };
}

export class FileIdentityStore implements IdentityStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<ClusterAgentIdentity | null> {
    let raw: string;

    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch {
      return null; // no file yet — first boot
    }

    try {
      return parseIdentity(raw);
    } catch (err) {
      // A corrupt file is a fresh start, not a crash — registration mints a new identity or 409s loudly if the name is taken.
      console.warn(
        `[cluster-agent] identity file ${this.filePath} is unreadable (${errorMessage(err)}) — treating as unregistered`,
      );

      return null;
    }
  }

  async save(identity: ClusterAgentIdentity): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(identity), {
      mode: 0o600,
    });
  }
}

/** Test double: the same contract with no filesystem. */
export class InMemoryIdentityStore implements IdentityStore {
  constructor(private identity: ClusterAgentIdentity | null = null) {}

  load(): Promise<ClusterAgentIdentity | null> {
    return Promise.resolve(this.identity);
  }

  save(identity: ClusterAgentIdentity): Promise<void> {
    this.identity = identity;

    return Promise.resolve();
  }
}
