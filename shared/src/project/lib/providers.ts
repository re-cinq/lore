import type { LlmPort } from "../agents/llm-port.js";
import type { K8sPort } from "../agents/k8s-port.js";

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
  k8s?: K8sPort;
}
