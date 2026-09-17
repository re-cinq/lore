// The cluster-agent's registered {id, token} identity, returned exactly once by register — persisted in a Kubernetes Secret, since losing it 409s (FR6). Every cluster-agent, a laptop's included, runs against a cluster, so there is no file fallback.

import { requiredEnv } from "@re-cinq/lore-shared/lib/required-env.js";
import type {
  ClusterAgentIdentity,
  IdentityStore,
  IdentityStoreConfig,
} from "../domain/identity.js";

export function identityStoreConfig(
  env: NodeJS.ProcessEnv,
): IdentityStoreConfig {
  return {
    name: requiredEnv(env, "LORE_CLUSTER_AGENT_IDENTITY_SECRET"),
    namespace: requiredEnv(env, "LORE_CLUSTER_AGENT_IDENTITY_NAMESPACE"),
    key: env.LORE_CLUSTER_AGENT_IDENTITY_KEY ?? "identity.json",
  };
}

/** Read a stored identity, or null when it is not one. Kept apart from the store so the parse check is testable without a cluster. */
export function parseIdentity(raw: string): ClusterAgentIdentity | null {
  const parsed = JSON.parse(raw) as Partial<ClusterAgentIdentity>;

  if (typeof parsed.id !== "string" || typeof parsed.token !== "string") {
    return null;
  }

  return { id: parsed.id, token: parsed.token };
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
