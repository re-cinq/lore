/**
 * Credentials a Station needs to run the agent, resolved by the runtime at
 * launch and injected into the Station (ADR-028). This is the seam that lets
 * each environment supply what the container needs without the backend
 * hardcoding it: local dev resolves the developer's `gh` token + claude config;
 * the cluster gets equivalents from K8s Secrets. The Docker backend consumes
 * this; the K8s backend uses declarative secretRefs and does not.
 */

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
  /** Host paths mounted read-only so the in-container `claude` CLI finds its
   *  auth (e.g. ~/.claude.json + ~/.claude). Used when no apiKey is available. */
  mounts?: StationMount[];
}

export interface StationCredentials {
  /** Token used for `git clone`/`push` inside the Station. */
  gitToken(): Promise<string>;
  /** LLM auth for the agent — an API key and/or config mounts. */
  llm(): Promise<StationLlmCredential>;
}
