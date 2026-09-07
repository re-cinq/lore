import type {
  AuditLogEntry,
  AuditPort,
} from "@re-cinq/lore-shared/project/audit/audit-port.js";
import { pipeline } from "./queues.js";

export type { AuditLogEntry };

export async function writeAuditLog(
  entry: AuditLogEntry,
  audit: AuditPort = pipeline().audit,
): Promise<void> {
  await audit.write(entry);
}
