import type { PgPool } from "../../memory-store.js";
import type { AuditPort, AuditLogEntry } from "./audit-port.js";

/**
 * Postgres-backed {@link AuditPort}: a single INSERT into
 * `pipeline.audit_log`. Relocated from the agent's `repositories/audit-log`
 * so the runner reaches the audit trail through the Project facade.
 */
export class PgAudit implements AuditPort {
  constructor(private readonly pool: PgPool) {}

  async write(entry: AuditLogEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO pipeline.audit_log
         (event_type, task_id, repo, actor, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        entry.event_type,
        entry.task_id ?? null,
        entry.repo ?? null,
        entry.actor ?? null,
        JSON.stringify(entry.payload),
      ],
    );
  }
}
