import type {
  AuditPort,
  AuditLogEntry,
  StoredAuditLogEntry,
} from "./audit-port.js";

/**
 * In-memory {@link AuditPort}: keeps every written entry for test assertions.
 * The double for jobs that record audit rows (e.g. the lease-reaper) so they
 * stay testable without a live `pipeline.audit_log`.
 */
export class InMemoryAudit implements AuditPort {
  readonly entries: AuditLogEntry[] = [];

  constructor(private readonly clock: () => Date = () => new Date()) {}

  private readonly writtenAt: Date[] = [];

  async write(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
    this.writtenAt.push(this.clock());
  }

  async listRecentByType(
    eventType: string,
    limit: number,
  ): Promise<StoredAuditLogEntry[]> {
    return this.entries
      .map((entry, i) => ({ ...entry, createdAt: this.writtenAt[i] }))
      .filter((entry) => entry.event_type === eventType)
      .reverse()
      .slice(0, limit);
  }
}
