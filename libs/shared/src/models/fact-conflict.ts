import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `memory.fact_conflicts` — a recorded contradiction between two facts.
 *
 * DDL: `scripts/infra/setup-memory-schema.sh`. Written BEFORE the old fact is
 * invalidated, so a disagreement is surfaced rather than silently resolved:
 * context assembly prefixes `[CONFLICT]` on a fact with a recent one.
 */

export const FactConflictSchema = z.object({
  id: z.string(),
  oldFactId: z.string(),
  newFactId: z.string(),
  similarity: z.number(),
  createdAt: z.date(),
});

export type FactConflict = z.infer<typeof FactConflictSchema>;

export const FACT_CONFLICT_COLUMNS = {
  id: "id",
  oldFactId: "old_fact_id",
  newFactId: "new_fact_id",
  similarity: "similarity",
  createdAt: "created_at",
} as const satisfies ColumnMap<FactConflict>;

export const FACT_CONFLICT_TABLE = "memory.fact_conflicts";
