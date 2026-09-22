// The cluster-agent's registered {id, token} identity, returned exactly once by register — losing it 409s, so where it persists is a boot decision (FR6).

export interface ClusterAgentIdentity {
  id: string;
  token: string;
}

export interface IdentityStore {
  load(): Promise<ClusterAgentIdentity | null>;
  save(identity: ClusterAgentIdentity): Promise<void>;
}

/** The Secret the identity persists in — decided at boot so a half-configured store refuses to start instead of idling behind a green /healthz. */
export interface IdentityStoreConfig {
  name: string;
  namespace: string;
  key: string;
}
