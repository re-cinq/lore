import type { AuditPort, AuditLogEntry } from "./audit-port.js";

/**
 * In-memory {@link AuditPort}: keeps every written entry for test assertions.
 * The double for jobs that record audit rows (e.g. the lease-reaper) so they
 * stay testable without a live `pipeline.audit_log`.
 */
export class InMemoryAudit implements AuditPort {
  readonly entries: AuditLogEntry[] = [];

  async write(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}
