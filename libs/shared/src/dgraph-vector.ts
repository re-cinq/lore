/** Vector-literal encoding + blank-node uid extraction shared by every dgraph-memory-store mutation path. */

/** Dgraph demands a float vector as a bracketed STRING literal (e.g. "[0.1,0.2,0.3]") — a raw JSON array is rejected; lives here once, used by every write path and $vec. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/** The optional embedding predicate, spread into a mutation's setJson (`{}` when absent); predicate defaults to `Memory.embedding`, persistFact passes `Fact.embedding`. */
export function embeddingField(
  embedding?: number[],
  predicate = "Memory.embedding",
): Record<string, string> {
  return embedding ? { [predicate]: toVectorLiteral(embedding) } : {};
}

/** Reads the assigned uid of a blank node back out of a mutation result; `label` is the blank node name without its `_:` prefix. */
export function newUid(
  mutateResult: unknown,
  label: string,
): string | undefined {
  return (mutateResult as { data?: { uids?: Record<string, string> } }).data
    ?.uids?.[label];
}
