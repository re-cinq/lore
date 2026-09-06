// Station credentials seam (ADR-028): docker injects mounts/apiKey, k8s uses declarative secretRefs.

export interface StationMount {
  /** Absolute host path. */
  hostPath: string;
  /** Absolute path inside the container (the runner's HOME is /home/node). */
  containerPath: string;
  /** Mount read-only (default true). The repo cache mounts read-write. */
  readOnly?: boolean;
}

export interface StationLlmCredential {
  /** Passed to the container as ANTHROPIC_API_KEY (preferred — most portable). */
  apiKey?: string;
  /** Host paths mounted read-only for in-container claude CLI auth; used when no apiKey available. */
  mounts?: StationMount[];
}

export interface StationCredentials {
  /** Token used for `git clone`/`push` inside the Station. */
  gitToken(): Promise<string>;
  /** LLM auth for the agent — an API key and/or config mounts. */
  llm(): Promise<StationLlmCredential>;
}
