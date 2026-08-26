import type { PgPool } from "../../memory-store.js";
import type {
  AuditPort,
  AuditLogEntry,
  StoredAuditLogEntry,
} from "./audit-port.js";

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

  async listRecentByType(
    eventType: string,
    limit: number,
  ): Promise<StoredAuditLogEntry[]> {
    const { rows } = await this.pool.query<{
      event_type: string;
      task_id: string | null;
      repo: string | null;
      actor: string | null;
      payload: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT event_type, task_id, repo, actor, payload, created_at
         FROM pipeline.audit_log
        WHERE event_type = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [eventType, limit],
    );

    return rows.map((row) => ({
      event_type: row.event_type,
      task_id: row.task_id,
      repo: row.repo,
      actor: row.actor,
      payload: row.payload,
      createdAt: new Date(row.created_at),
    }));
  }
}
