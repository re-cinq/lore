import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `memory.audit_log` — the memory subsystem's own operation trail.
 *
 * DDL: `scripts/infra/setup-memory-schema.sh`. Distinct from
 * `pipeline.audit_log`, which records dark-factory DECISIONS and carries
 * task/repo instead of agent/memory-key — see `audit-log-entry.ts`. The two
 * share a table name in different schemas, which is exactly why each model
 * names its schema.
 */

export const MemoryAuditEntrySchema = z.object({
  id: z.string(),
  agentId: z.string(),
  operation: z.string(),
  memoryKey: z.string().nullable(),
  poolName: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.date(),
});

export type MemoryAuditEntry = z.infer<typeof MemoryAuditEntrySchema>;

export const MEMORY_AUDIT_ENTRY_COLUMNS = {
  id: "id",
  agentId: "agent_id",
  operation: "operation",
  memoryKey: "memory_key",
  poolName: "pool_name",
  metadata: "metadata",
  createdAt: "created_at",
} as const satisfies ColumnMap<MemoryAuditEntry>;

export const MEMORY_AUDIT_ENTRY_TABLE = "memory.audit_log";
