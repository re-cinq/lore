import type { PipelineRepositories } from "../pipeline/pipeline-repositories.js";

/** Optional injected clients for capabilities beyond pg+dgraph. */
export interface ProjectProviders {
  /** Org-wide pipeline bundle (avoid per-request construction). */
  pipeline?: PipelineRepositories;
}
