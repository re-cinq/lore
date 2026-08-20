import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `memory.memories` — one agent memory entry, versioned per `(agentId, key)`.
 *
 * DDL: `scripts/infra/setup-memory-schema.sh`, plus the decay columns from
 * migration `0013_memory_hippo_columns.sql` and `repo`.
 *
 * Named `MemoryEntry`, not `Memory`: the schema, the module and the concept are
 * all called "memory" already, and two of the four previous declarations of this
 * row were both called `MemoryRecord` while disagreeing about what it held —
 * one `{key, value, version}`, the other `Record<string, unknown>`.
 *
 * `embedding` is a pgvector `VECTOR(768)` column and is deliberately NOT part of
 * the model: no reader wants 768 floats, and every SELECT here names its columns.
 */

export const MemoryEntrySchema = z.object({
  id: z.string(),
  agentId: z.string(),
  key: z.string(),
  value: z.string(),
  version: z.number(),
  isDeleted: z.boolean(),
  poolId: z.string().nullable(),
  ttlSeconds: z.number().nullable(),
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
  metadata: z.record(z.unknown()).nullable(),
  repo: z.string().nullable(),
  retrievalCount: z.number().nullable(),
  lastRetrievedAt: z.date().nullable(),
  halfLifeDays: z.number().nullable(),
});

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export const MEMORY_ENTRY_COLUMNS = {
  id: "id",
  agentId: "agent_id",
  key: "key",
  value: "value",
  version: "version",
  isDeleted: "is_deleted",
  poolId: "pool_id",
  ttlSeconds: "ttl_seconds",
  expiresAt: "expires_at",
  createdAt: "created_at",
  metadata: "metadata",
  repo: "repo",
  retrievalCount: "retrieval_count",
  lastRetrievedAt: "last_retrieved_at",
  halfLifeDays: "half_life_days",
} as const satisfies ColumnMap<MemoryEntry>;

export const MEMORY_ENTRY_TABLE = "memory.memories";
