-- 0014_dark_factory_audit_log: backfill pipeline.audit_log (ADR-016 dark factory).
--
-- The dark-factory work writes auto-merge decisions, lease events, and setting
-- changes to pipeline.audit_log (agent/src/lib/audit.ts, auto-merge.ts, the
-- baseline counter in dark-factory-baseline.ts). The table is declared in the
-- baseline setup-dark-factory-schema.sh, but DBs bootstrapped before that landed
-- never got it — on prod, `SELECT count(*) FROM pipeline.audit_log ...` throws
-- `relation "pipeline.audit_log" does not exist`, breaking auto-merge decision
-- logging and the SC1/SC4/SC6 baseline snapshots.
--
-- Unlike memory.* (postgres-owned, see 0013), the `pipeline` schema is owned by
-- `lore` — the migration runner — so this CREATE applies cleanly through the
-- normal channel; no privilege guard needed. Mirrors setup-dark-factory-schema.sh.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS pipeline.audit_log (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   TEXT         NOT NULL,
  task_id      UUID,
  repo         TEXT,
  actor        TEXT,
  payload      JSONB        NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_task_idx
  ON pipeline.audit_log(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_event_idx
  ON pipeline.audit_log(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_repo_idx
  ON pipeline.audit_log(repo, created_at DESC);
