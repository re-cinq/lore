// Embeddings from any OpenAI-compatible host (`POST {baseUrl}/embeddings`): OpenAI itself, Azure/Microsoft Foundry's `/openai/v1`, or another server speaking the same body. The width is asked for explicitly so the vectors fit the 768-wide stored columns.

import {
  embedBatchwise,
  MAX_EMBEDDING_TEXT_CHARS,
} from "./embedding-batches.js";
import { recordEmbeddingOutcome } from "./embedding-health.js";
import type { EmbeddingProvider } from "./embedding-provider.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "text-embedding-3-small";
const DIMENSIONS = 768;
const TIMEOUT_MS = 30_000;

export interface OpenAiEmbeddingProviderOptions {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

interface EmbeddingsResponse {
  data?: Array<{ index: number; embedding: number[] }>;
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly vendor = "openai";
  readonly model: string;
  readonly dimensions = DIMENSIONS;
  private readonly baseUrl: string;

  constructor(private readonly opts: OpenAiEmbeddingProviderOptions = {}) {
    this.model = opts.model || DEFAULT_MODEL;
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async embed(texts: string[]): Promise<Array<number[] | null>> {
    if (!this.opts.apiKey) {
      return refused(texts, null);
    }

    return embedBatchwise(texts, (batch) => this.embedBatch(batch));
  }

  private async embedBatch(batch: string[]): Promise<Array<number[] | null>> {
    const res = await (this.opts.fetchFn ?? fetch)(
      `${this.baseUrl}/embeddings`,
      this.requestInit(batch),
    );

    if (!res.ok) {
      console.error(`[embeddings] OpenAI embedding failed: ${res.status}`);

      return refused(batch, res.status);
    }

    return this.checkedVectors(batch, (await res.json()) as EmbeddingsResponse);
  }

  private checkedVectors(
    batch: string[],
    response: EmbeddingsResponse,
  ): Array<number[] | null> {
    const vectors = orderedVectors(response, batch.length);

    if (!vectors) {
      console.error(
        `[embeddings] OpenAI embedding answered with the wrong count or width for ${this.model} (want ${batch.length} vectors of ${DIMENSIONS})`,
      );

      return refused(batch, null);
    }
    recordEmbeddingOutcome({ ok: true });

    return vectors;
  }

  private requestInit(batch: string[]): RequestInit {
    return {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: batch.map((text) => text.substring(0, MAX_EMBEDDING_TEXT_CHARS)),
        dimensions: DIMENSIONS,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    };
  }
}

function refused(texts: string[], status: number | null): null[] {
  recordEmbeddingOutcome({ ok: false, status });

  return texts.map(() => null);
}

/** The vectors in input order, or null when the count or any width is not what was asked for: a shifted or wrong-width vector must never reach the index. */
function orderedVectors(
  response: EmbeddingsResponse,
  expectedCount: number,
): number[][] | null {
  const ordered = [...(response.data ?? [])].sort((a, b) => a.index - b.index);
  const vectors = ordered.map((entry) => entry.embedding);
  const sound =
    vectors.length === expectedCount &&
    vectors.every((vector) => vector.length === DIMENSIONS);

  return sound ? vectors : null;
}
