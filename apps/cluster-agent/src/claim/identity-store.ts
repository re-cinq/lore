import { errorMessage } from "@re-cinq/lore-shared";
/**
 * The cluster-agent's registered identity — the `{id, token}` pair
 * `POST /api/cluster-agents/register` returns exactly once. Losing it means the
 * name is unrecoverable (re-registering a known name without `current_token` is
 * a 409 by design), so it is persisted outside the process.
 *
 * File-backed for now: the standalone satellite chart (FR6) mounts a Kubernetes
 * Secret at this path so pod restarts do not re-register; until the chart
 * lands, the default path under $HOME serves local runs.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

export interface ClusterAgentIdentity {
  id: string;
  token: string;
}

export interface IdentityStore {
  load(): Promise<ClusterAgentIdentity | null>;
  save(identity: ClusterAgentIdentity): Promise<void>;
}

/** Where the identity persists — decided at boot, before anything async, so a
 *  half-configured Secret store refuses to start instead of idling behind a
 *  green /healthz with a claim loop that never began. */
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

/**
 * Read a stored identity, or null when it is not one.
 *
 * Shared by both stores: the shape they persist is the same shape, and a second
 * copy of this check is a second place for it to drift — the two warnings had
 * already worded themselves differently.
 */
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
      // A corrupt file is a fresh start, not a crash: registration will mint a
      // new identity for a new name, or 409 loudly if the name is taken.
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
