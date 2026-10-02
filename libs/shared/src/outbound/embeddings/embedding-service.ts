// The vendor-neutral embedding entry point: delegates to the configured `EmbeddingProvider` and degrades to null when it throws, so callers fall back to keyword-only search.

import { recordEmbeddingOutcome } from "./embedding-health.js";
import { Embeddings } from "./embeddings.js";

export {
  EMBEDDER_DEGRADED_AFTER,
  embedderDegraded,
  embeddingHealth,
  recordEmbeddingOutcome,
  resetEmbeddingHealth,
  type EmbeddingHealth,
  type EmbeddingOutcome,
} from "./embedding-health.js";

export async function getQueryEmbedding(
  query: string,
): Promise<number[] | null> {
  const [embedding] = await getQueryEmbeddings([query]);

  return embedding;
}

/** One vector per text, in input order, from as few provider calls as its request ceilings allow; a text whose batch failed gets null. A spec with hundreds of statements embedded one call at a time outran its station's 10-minute deadline (re-cinq/Otto, 2026-09-28). */
export async function getQueryEmbeddings(
  texts: string[],
): Promise<Array<number[] | null>> {
  if (texts.length === 0) {
    return [];
  }

  try {
    return await Embeddings.instance.embed(texts);
  } catch (err) {
    console.error("[embeddings] embedding provider error:", err);
    recordEmbeddingOutcome({ ok: false, status: null });

    return texts.map(() => null);
  }
}
