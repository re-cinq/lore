import { randomUUID } from "node:crypto";
import { cosineSimilarity, parseEmbedding } from "../domain/spec-judge.js";

/** Cosine at/above which a new fact is treated as contradicting an older one. */
export const FACT_SIMILARITY_THRESHOLD = 0.92;

/** The conflict is RECORDED, not just acted on: a fact that quietly vanished is indistinguishable from one that was never written, and the assembled context surfaces recent conflicts so an agent can see the knowledge is disputed. */
function conflictRecord(
  oldUid: unknown,
  newUid: string | undefined,
  { similarity, now }: { similarity: number; now: string },
): Record<string, unknown> {
  return {
    "dgraph.type": "FactConflict",
    "FactConflict.xid": randomUUID(),
    "FactConflict.old_fact": { uid: oldUid },
    ...(newUid ? { "FactConflict.new_fact": { uid: newUid } } : {}),
    "FactConflict.similarity": similarity,
    "FactConflict.created_at": now,
  };
}

/** Deactivating a fact is a TIME write too: `valid_to` closes it and `invalidated_by` names the fact that replaced it, so the old text stays readable as history. */
function deactivateFact(
  oldUid: unknown,
  newUid: string | undefined,
  now: string,
): Record<string, unknown> {
  return {
    uid: oldUid,
    "Fact.active": false,
    "Fact.valid_to": now,
    ...(newUid ? { "Fact.invalidated_by": { uid: newUid } } : {}),
  };
}

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
    deactivateFact(candidate.uid, newUid, now),
    conflictRecord(candidate.uid, newUid, { similarity, now }),
  ];
}
