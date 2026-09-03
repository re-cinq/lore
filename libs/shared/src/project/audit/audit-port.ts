/** One row in `pipeline.audit_log`. Dark-factory events: `auto_merge_decision`, `dark_factory_setting_changed`, `lease_expired`, `escalation_issued`. Payload shapes documented in `specs/6-dark-factory/data-model.md`. */
export interface AuditLogEntry {
  event_type: string;
  task_id?: string | null;
  repo?: string | null;
  actor?: string | null;
  payload: Record<string, unknown>;
}

/** The append-only audit surface. The runner records lease takeovers and auto-merge decisions through here instead of a bespoke DB writer, so the kernel never imports a pg pool directly. A stored row: what {@link AuditPort.listRecentByType} reads back. */
export interface StoredAuditLogEntry extends AuditLogEntry {
  createdAt: Date;
}

export interface AuditPort {
  write(entry: AuditLogEntry): Promise<void>;
  /** Newest-first entries of one event type — the registered-clusters page reads `cluster_agent_offline` through this (FR7). */
  listRecentByType(
    eventType: string,
    limit: number,
  ): Promise<StoredAuditLogEntry[]>;
}
