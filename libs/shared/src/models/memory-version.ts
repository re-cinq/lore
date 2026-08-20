import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `memory.memory_versions` — the prior values of a memory entry.
 *
 * DDL: `scripts/infra/setup-memory-schema.sh`, re-asserted by migration
 * `0039_memory_memory_versions.sql`. `embedding` is excluded for the same
 * reason as on the entry itself.
 */

export const MemoryVersionSchema = z.object({
  id: z.string(),
  memoryId: z.string(),
  version: z.number(),
  value: z.string(),
  createdAt: z.date(),
});

export type MemoryVersion = z.infer<typeof MemoryVersionSchema>;

export const MEMORY_VERSION_COLUMNS = {
  id: "id",
  memoryId: "memory_id",
  version: "version",
  value: "value",
  createdAt: "created_at",
} as const satisfies ColumnMap<MemoryVersion>;

export const MEMORY_VERSION_TABLE = "memory.memory_versions";
