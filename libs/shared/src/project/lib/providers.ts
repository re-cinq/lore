import type { LlmPort } from "../agents/llm-port.js";
import type { StationBackend } from "../agents/station-port.js";
import type { PipelineRepositories } from "../pipeline/pipeline-repositories.js";

/**
 * Optional injected clients for capabilities beyond pg+dgraph. Each runtime's
 * boot code builds these from env and passes them; shared defines only the
 * interfaces, never imports the heavy SDKs. A method whose provider is absent
 * throws a clear error (same honest-throw pattern as un-wired ports). Vertex
 * query embeddings are NOT here — they are a stateless, repo-agnostic shared
 * service (embeddings/embedding-service), not a per-project injected client.
 */
export interface ProjectProviders {
  llm?: LlmPort;
  /** The Station execution backend (K8s in cluster, Docker locally; ADR-028),
   *  chosen at the runtime's composition root via selectStationBackend. */
  station?: StationBackend;
  /**
   * The org-wide `pipeline.*` bundle, built once per process at the runtime's
   * composition root. Injected rather than built here because `createProject`
   * runs per repo, per call — constructing these adapters inside it is what had
   * lore-api minting a fresh `PgAssemblyRuns`/`PgAudit`/`DbLeaseBackend` on
   * every request for tables that are not repo-scoped in the first place.
   */
  pipeline?: PipelineRepositories;
}
