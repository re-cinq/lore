// How texts are cut and grouped before one embedding call; shared by every adapter so a text is cut the same way whichever vendor embeds it.

/** Vertex's per-request ceilings for text-embedding-005: 250 instances and 20k tokens. Chars stand in for tokens at a conservative 50k (~12.5k tokens), since each text is already capped at 8000 chars. Other vendors' ceilings are looser, so one grouping serves all. */
const MAX_BATCH_TEXTS = 250;
const MAX_BATCH_CHARS = 50_000;

export const MAX_EMBEDDING_TEXT_CHARS = 8000;

/** Groups texts, in order, into the fewest batches one embedding call accepts. */
export function embeddingBatches(texts: string[]): string[][] {
  const batches: string[][] = [];
  let batchChars = 0;

  for (const text of texts) {
    const chars = Math.min(text.length, MAX_EMBEDDING_TEXT_CHARS);
    const current = batches.at(-1);

    if (
      !current ||
      current.length >= MAX_BATCH_TEXTS ||
      batchChars + chars > MAX_BATCH_CHARS
    ) {
      batches.push([text]);
      batchChars = chars;
      continue;
    }
    current.push(text);
    batchChars += chars;
  }

  return batches;
}

/** Embeds the batches one after the other and joins their vectors in input order. */
export async function embedBatchwise(
  texts: string[],
  embedBatch: (batch: string[]) => Promise<Array<number[] | null>>,
): Promise<Array<number[] | null>> {
  const vectors: Array<number[] | null> = [];

  for (const batch of embeddingBatches(texts)) {
    vectors.push(...(await embedBatch(batch)));
  }

  return vectors;
}
