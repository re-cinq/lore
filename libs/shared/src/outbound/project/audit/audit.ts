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
}
