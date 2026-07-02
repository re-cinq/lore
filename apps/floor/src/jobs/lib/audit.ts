import type {
  AuditLogEntry,
  AuditPort,
} from "@re-cinq/lore-shared/project/audit/audit-port.js";
import { auditLog } from "../../kernel/queues.js";

export type { AuditLogEntry };

export async function writeAuditLog(
  entry: AuditLogEntry,
  audit: AuditPort = auditLog(),
): Promise<void> {
  await audit.write(entry);
}
