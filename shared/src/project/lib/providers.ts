import type { LlmPort } from "../agents/llm-port.js";
import type { K8sPort } from "../agents/k8s-port.js";

/**
 * Embeddings port for the (future) shared knowledge.assembleContext vector
 * retrieval. Defined now so the contract is stable; assembleContext stays
 * delegated until the retrieval subtree is relocated.
 */
export interface EmbeddingsPort {
  embed(text: string): Promise<number[]>;
}

/**
 * Optional injected clients for capabilities beyond pg+dgraph. Each runtime's
 * boot code builds these from env and passes them; shared defines only the
 * interfaces, never imports the heavy SDKs. A method whose provider is absent
 * throws a clear error (same honest-throw pattern as un-wired ports).
 */
export interface ProjectProviders {
  llm?: LlmPort;
  k8s?: K8sPort;
  embeddings?: EmbeddingsPort;
}
