#!/usr/bin/env bash
set -euo pipefail

NS="lore-db"
POD="lore-db-1"

echo "[lore] Creating pipeline schema and tables..."

kubectl exec -n "$NS" "$POD" -- psql -U postgres -d lore -c "
  CREATE SCHEMA IF NOT EXISTS pipeline;

  CREATE TABLE IF NOT EXISTS pipeline.tasks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    description      TEXT NOT NULL,
    task_type        TEXT NOT NULL DEFAULT 'general',
    status           TEXT NOT NULL DEFAULT 'pending',
    target_repo      TEXT NOT NULL,
    target_branch    TEXT,
    agent_id         TEXT,
    pr_url           TEXT,
    pr_number        INTEGER,
    review_iteration INTEGER NOT NULL DEFAULT 0,
    context_bundle   JSONB,
    failure_reason   TEXT,
    created_by       TEXT NOT NULL DEFAULT 'ui',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    priority         TEXT NOT NULL DEFAULT 'normal'
  );

  CREATE INDEX IF NOT EXISTS tasks_status_idx ON pipeline.tasks (status);
  CREATE INDEX IF NOT EXISTS tasks_created_idx ON pipeline.tasks (created_at DESC);
  CREATE INDEX IF NOT EXISTS tasks_agent_idx ON pipeline.tasks (agent_id);

  CREATE TABLE IF NOT EXISTS pipeline.task_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID NOT NULL REFERENCES pipeline.tasks(id),
    from_status TEXT,
    to_status   TEXT NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS task_events_timeline_idx
    ON pipeline.task_events (task_id, created_at);

  -- Auto-update updated_at on tasks
  CREATE OR REPLACE FUNCTION pipeline.update_timestamp()
  RETURNS TRIGGER AS \$\$
  BEGIN
    NEW.updated_at = now();
    RETURN NEW;
  END;
  \$\$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS tasks_updated_at ON pipeline.tasks;
  CREATE TRIGGER tasks_updated_at
    BEFORE UPDATE ON pipeline.tasks
    FOR EACH ROW
    EXECUTE FUNCTION pipeline.update_timestamp();

  -- Log access audit trail
  CREATE TABLE IF NOT EXISTS pipeline.log_access (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID NOT NULL REFERENCES pipeline.tasks(id),
    user_id     TEXT NOT NULL,
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_address  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_log_access_task_id ON pipeline.log_access(task_id);
  CREATE INDEX IF NOT EXISTS idx_log_access_user_id ON pipeline.log_access(user_id);

  -- Add log_url to tasks
  DO \$\$ BEGIN
    ALTER TABLE pipeline.tasks ADD COLUMN log_url TEXT;
  EXCEPTION WHEN duplicate_column THEN NULL;
  END \$\$;

  -- Local task runner: claim tracking
  DO \$\$ BEGIN
    ALTER TABLE pipeline.tasks ADD COLUMN claimed_by TEXT;
  EXCEPTION WHEN duplicate_column THEN NULL;
  END \$\$;
  DO \$\$ BEGIN
    ALTER TABLE pipeline.tasks ADD COLUMN claimed_at TIMESTAMPTZ;
  EXCEPTION WHEN duplicate_column THEN NULL;
  END \$\$;

  -- Task priority: 'normal' (backlog, wait for local pickup) or 'immediate' (GKE agent auto-executes)
  DO \$\$ BEGIN
    ALTER TABLE pipeline.tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
  EXCEPTION WHEN duplicate_column THEN NULL;
  END \$\$;
  CREATE INDEX IF NOT EXISTS tasks_priority_idx ON pipeline.tasks (priority) WHERE status = 'pending';

  -- Per-client API tokens with scoped permissions
  CREATE TABLE IF NOT EXISTS pipeline.api_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    token_hash  TEXT NOT NULL UNIQUE,
    scopes      TEXT[] NOT NULL DEFAULT '{read}',
    created_by  TEXT NOT NULL,
    expires_at  TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,
    last_used   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS api_tokens_hash_idx ON pipeline.api_tokens (token_hash) WHERE revoked_at IS NULL;

  GRANT USAGE ON SCHEMA pipeline TO lore;
  GRANT ALL ON ALL TABLES IN SCHEMA pipeline TO lore;
  ALTER DEFAULT PRIVILEGES IN SCHEMA pipeline GRANT ALL ON TABLES TO lore;
"

echo "[lore] Pipeline schema created."
