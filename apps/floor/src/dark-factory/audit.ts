import {
  pgAuditLog,
  type AuditLogEntry,
  type AuditLogRepository,
} from "../kernel/repositories/index.js";

export type { AuditLogEntry };

export async function writeAuditLog(
  entry: AuditLogEntry,
  repo: AuditLogRepository = pgAuditLog,
): Promise<void> {
  await repo.insert(entry);
}
