import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `memory.memories` — one agent memory entry, versioned per `(agentId, key)`; named `MemoryEntry` not `Memory` since two prior `MemoryRecord` declarations disagreed on shape. `embedding` (pgvector `VECTOR(768)`) deliberately not part of the model — every SELECT here names its columns. */

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
