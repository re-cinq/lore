import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `memory.facts` — one extracted fact with temporal validity: live while `validTo` is null, a contradiction sets it and points `invalidatedBy` at the replacement; a row carries `memoryId` OR `episodeId`, enforced by the DB's `facts_source_check` not this schema. */

export const FactConfidenceSchema = z.enum([
  "verified",
  "observed",
  "inferred",
  "stale",
]);

export const FactSchema = z.object({
  id: z.string(),
  memoryId: z.string().nullable(),
  episodeId: z.string().nullable(),
  factText: z.string(),
  validFrom: z.date(),
  validTo: z.date().nullable(),
  invalidatedBy: z.string().nullable(),
  createdAt: z.date(),
  retrievalCount: z.number().nullable(),
  lastRetrievedAt: z.date().nullable(),
  halfLifeDays: z.number().nullable(),
  confidence: z.string().nullable(),
});

export type FactConfidence = z.infer<typeof FactConfidenceSchema>;
export type Fact = z.infer<typeof FactSchema>;

export const FACT_COLUMNS = {
  id: "id",
  memoryId: "memory_id",
  episodeId: "episode_id",
  factText: "fact_text",
  validFrom: "valid_from",
  validTo: "valid_to",
  invalidatedBy: "invalidated_by",
  createdAt: "created_at",
  retrievalCount: "retrieval_count",
  lastRetrievedAt: "last_retrieved_at",
  halfLifeDays: "half_life_days",
  confidence: "confidence",
} as const satisfies ColumnMap<Fact>;

export const FACT_TABLE = "memory.facts";
