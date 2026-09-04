import { randomUUID } from "node:crypto";
import { cosineSimilarity, parseEmbedding } from "./spec-judge.js";

/** Cosine at/above which a new fact is treated as contradicting an older one. */
export const FACT_SIMILARITY_THRESHOLD = 0.92;

/** The Fact-deactivate + FactConflict pair for one candidate, or empty when it's the new fact itself or not actually similar. */
export function contradictionNodes(
  candidate: Record<string, unknown>,
  embedding: number[],
  newUid: string | undefined,
  now: string,
): Record<string, unknown>[] {
  const candEmbedding = parseEmbedding(candidate["Fact.embedding"]);

  if (!candEmbedding) {
    return [];
  }
  const similarity = cosineSimilarity(embedding, candEmbedding);

  if (similarity < FACT_SIMILARITY_THRESHOLD) {
    return [];
  }

  return [
    {
      uid: candidate.uid,
      "Fact.active": false,
      "Fact.valid_to": now,
      ...(newUid ? { "Fact.invalidated_by": { uid: newUid } } : {}),
    },
    {
      "dgraph.type": "FactConflict",
      "FactConflict.xid": randomUUID(),
      "FactConflict.old_fact": { uid: candidate.uid },
      ...(newUid ? { "FactConflict.new_fact": { uid: newUid } } : {}),
      "FactConflict.similarity": similarity,
      "FactConflict.created_at": now,
    },
  ];
}
