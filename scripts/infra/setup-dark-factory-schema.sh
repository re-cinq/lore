#!/usr/bin/env bash
set -euo pipefail

# Dark Factory schema migration (spec 6-dark-factory).
# Idempotent — safe to re-run.

NS="lore-db"
POD="lore-db-1"

echo "[lore] Applying dark-factory schema migration..."

kubectl exec -n "$NS" "$POD" -- psql -U postgres -d lore -c "
  -- Branch-as-state lease (FR1.6, Q4 clarification). task_id is NULL for
  -- task-less runs (detection assembly lines; ADR-019 amendment).
  CREATE TABLE IF NOT EXISTS pipeline.task_leases (
    branch_name   TEXT        PRIMARY KEY,
    task_id       UUID,
    holder        TEXT        NOT NULL,
    acquired_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    phase         TEXT,
    CONSTRAINT task_leases_task_fk FOREIGN KEY (task_id)
      REFERENCES pipeline.tasks(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS task_leases_expires_idx
    ON pipeline.task_leases(expires_at);

  -- Pre-feature counter snapshot for SC1/SC4/SC6 deltas (T011b).
  CREATE TABLE IF NOT EXISTS pipeline.dark_factory_baseline (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    repo          TEXT         NOT NULL,
    captured_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    window_start  TIMESTAMPTZ  NOT NULL,
    window_end    TIMESTAMPTZ  NOT NULL,
    counters      JSONB        NOT NULL
  );
  CREATE INDEX IF NOT EXISTS dark_factory_baseline_repo_idx
    ON pipeline.dark_factory_baseline(repo, captured_at DESC);

  -- Pipeline-side audit log. The existing memory.audit_log is memory-scoped
  -- and lacks task/repo fields needed for dark-factory events. New table
  -- here in the pipeline schema.
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

  -- Per-task overrides over per-repo dark_factory settings (FR3.6).
  ALTER TABLE pipeline.tasks
    ADD COLUMN IF NOT EXISTS dark_factory_overrides JSONB DEFAULT NULL;
"

echo "[lore] Dark-factory schema migration complete."
echo "[lore] Verify with: kubectl exec -n $NS $POD -- psql -U postgres -d lore -c '\\d pipeline.task_leases'"
