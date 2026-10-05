// `Embeddings` — the process-wide singleton holding the active {@link EmbeddingProvider}.

import type { EmbeddingProvider } from "./embedding-provider.js";
import { selectEmbeddingProvider } from "./select-embedding-provider.js";

let current: EmbeddingProvider | null = null;

export class Embeddings {
  static get instance(): EmbeddingProvider {
    if (!current) {
      current = selectEmbeddingProvider(process.env);
    }

    return current;
  }

  static setInstance(provider: EmbeddingProvider): void {
    current = provider;
  }

  static reset(): void {
    current = null;
  }
}
