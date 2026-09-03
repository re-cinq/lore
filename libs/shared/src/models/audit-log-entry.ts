import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `pipeline.audit_log` — the dark-factory decision trail (ADR-016); distinct from `memory.audit_log`, which is memory-scoped and carries no task/repo. */

export const AuditLogEntrySchema = z.object({
  id: z.string(),
  eventType: z.string(),
  taskId: z.string().nullable(),
  repo: z.string().nullable(),
  actor: z.string().nullable(),
  payload: z.record(z.unknown()),
  createdAt: z.date(),
});

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export const AUDIT_LOG_ENTRY_COLUMNS = {
  id: "id",
  eventType: "event_type",
  taskId: "task_id",
  repo: "repo",
  actor: "actor",
  payload: "payload",
  createdAt: "created_at",
} as const satisfies ColumnMap<AuditLogEntry>;

export const AUDIT_LOG_ENTRY_TABLE = "pipeline.audit_log";
