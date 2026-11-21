import type { AuditPort, AuditLogEntry } from "./audit-port.js";

/** project.audit — repo-bound audit surface; stamps the bound repo onto every entry so callers only supply event, task, payload. */
export class Audit {
  constructor(
    private readonly repo: string,
    private readonly port: AuditPort,
  ) {}

  write(entry: Omit<AuditLogEntry, "repo">): Promise<void> {
    return this.port.write({ ...entry, repo: this.repo });
  }

  recorded(
    eventType: string,
    fields: Record<string, unknown>,
  ): Promise<boolean> {
    return this.port.hasEntry(eventType, this.repo, fields);
  }
}

/** Writes one audit entry through the injected port. */
export async function writeAuditLog(
  entry: AuditLogEntry,
  audit: AuditPort,
): Promise<void> {
  await audit.write(entry);
}
