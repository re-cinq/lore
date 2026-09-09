// The cluster-agent's registered {id, token} identity, returned exactly once by register — losing it 409s, so where it persists is a boot decision (FR6).

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
