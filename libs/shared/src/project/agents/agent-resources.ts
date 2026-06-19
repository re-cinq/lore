/**
 * The `resources` block of an AgentDefinition recipe (ADR-030): what an Agent
 * needs available at run time. Flat and declarative so it round-trips through
 * YAML / JSON Schema. Credentials are always REFERENCES (a key into the per-repo
 * secret allowlist), never literals — the materializer resolves them at run time.
 */

/** A plain, non-secret environment variable the tool process sees. */
export interface EnvVarSpec {
  name: string;
  value: string;
}

/** A secret made available as an env var. `ref` is an allowlisted secret-store key. */
export interface SecretRef {
  /** The env var the tool sees. */
  name: string;
  /** Key into the per-repo secret allowlist (`settings.agent_secrets`). */
  ref: string;
}

export type McpTransport = "stdio" | "http" | "sse";

/**
 * An MCP server made available to the run. stdio carries `command`/`args` (a
 * PRIVILEGED, two-key-gated field — arbitrary execution); http/sse carry `url`
 * (allowlist-checked) and an optional `headers_secret` resolved to Authorization.
 */
export interface McpServerSpec {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  headers_secret?: string;
}

/** An extra repo cloned beside the target. `url` host is allowlist-checked. */
export interface ExtraRepoSpec {
  name: string;
  url: string;
  ref?: string;
  /** Clone destination relative to the workdir. */
  path?: string;
  /** Secret ref for the clone token. */
  token_secret?: string;
}

export interface AgentResources {
  env?: EnvVarSpec[];
  secrets?: SecretRef[];
  mcp_servers?: McpServerSpec[];
  repos?: ExtraRepoSpec[];
}
