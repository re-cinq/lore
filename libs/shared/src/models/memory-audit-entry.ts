import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `memory.audit_log` — the memory subsystem's own operation trail; distinct from `pipeline.audit_log` (dark-factory decisions, task/repo-keyed — see `audit-log-entry.ts`), same table name in a different schema. */

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
