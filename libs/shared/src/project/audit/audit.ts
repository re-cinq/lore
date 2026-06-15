import type { AuditPort, AuditLogEntry } from "./audit-port.js";

/**
 * project.audit — the repo-bound audit surface. Stamps the bound repo onto
 * every entry so callers only supply the event, task, and payload.
 */
export class Audit {
  constructor(
    private readonly repo: string,
    private readonly port: AuditPort,
  ) {}

  write(entry: Omit<AuditLogEntry, "repo">): Promise<void> {
    return this.port.write({ ...entry, repo: this.repo });
  }
}
