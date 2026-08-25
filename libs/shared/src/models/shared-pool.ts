import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `memory.shared_pools` — a named pool several agents write memories into.
 *
 * DDL: `scripts/infra/setup-memory-schema.sh`. `name` is unique; a memory joins
 * a pool through `memory.memories.pool_id`.
 */

export const SharedPoolSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdBy: z.string(),
  createdAt: z.date(),
});

export type SharedPool = z.infer<typeof SharedPoolSchema>;

export const SHARED_POOL_COLUMNS = {
  id: "id",
  name: "name",
  createdBy: "created_by",
  createdAt: "created_at",
} as const satisfies ColumnMap<SharedPool>;

export const SHARED_POOL_TABLE = "memory.shared_pools";
