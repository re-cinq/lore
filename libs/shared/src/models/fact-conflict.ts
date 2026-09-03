import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** A recorded contradiction between two facts; written before old fact invalidated; context prefixes [CONFLICT]. */

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
