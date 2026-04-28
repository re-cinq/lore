import { query } from "../db.js";

/**
 * One row in `pipeline.audit_log`. Used by dark-factory events:
 * `auto_merge_decision`, `dark_factory_setting_changed`, `lease_expired`,
 * `escalation_issued`. Payload shapes documented in
 * `specs/6-dark-factory/data-model.md`.
 */
export interface AuditLogEntry {
  event_type: string;
  task_id?: string | null;
  repo?: string | null;
  actor?: string | null;
  payload: Record<string, unknown>;
}

export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  await query(
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
