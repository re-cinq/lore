import type { PipelineRepositories } from "../pipeline/pipeline-repositories.js";
import type { TracePort } from "../trace/trace-port.js";

/** Optional injected clients for capabilities beyond pg+dgraph. */
export interface ProjectProviders {
  /** Org-wide pipeline bundle (avoid per-request construction). */
  pipeline?: PipelineRepositories;
  /** The spec-traceability graph reads; Dgraph over the Project's client when absent. */
  trace?: TracePort;
}
