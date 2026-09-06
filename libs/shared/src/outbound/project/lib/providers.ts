import type { LlmPort } from "../agents/llm-port.js";
import type { StationBackend } from "../agents/station-port.js";
import type { PipelineRepositories } from "../pipeline/pipeline-repositories.js";

/** Optional injected clients for capabilities beyond pg+dgraph. */
export interface ProjectProviders {
  llm?: LlmPort;
  /** Station execution backend (K8s or Docker; ADR-028). */
  station?: StationBackend;
  /** Org-wide pipeline bundle (avoid per-request construction). */
  pipeline?: PipelineRepositories;
}
