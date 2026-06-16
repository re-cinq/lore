#!/usr/bin/env bash
set -euo pipefail
NS="lore-db" POD="lore-db-1"
echo "[lore] Creating repos schema..."
kubectl exec -n "$NS" "$POD" -- psql -U postgres -d lore -c "
  CREATE SCHEMA IF NOT EXISTS lore;
  CREATE TABLE IF NOT EXISTS lore.repos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    full_name TEXT UNIQUE NOT NULL,
    team TEXT,
    onboarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ingested_at TIMESTAMPTZ,
    onboarding_pr_url TEXT,
    onboarding_pr_merged BOOLEAN NOT NULL DEFAULT false,
    settings JSONB
  );
  CREATE INDEX IF NOT EXISTS repos_owner_idx ON lore.repos (owner);
  CREATE INDEX IF NOT EXISTS repos_team_idx ON lore.repos (team);

  -- Org-wide key-value settings (api_url, ingest_token, approval_config).
  -- Read by the web-ui settings page and agent/src/approval.ts.
  CREATE TABLE IF NOT EXISTS lore.settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- lore.agent_definitions (agent-defs-as-data, ADR-024) is created by the lore-owned migration
  -- ui-helm/migrations/0015_agents_table.sql, not here: it must be owned by the
  -- 'lore' migration runner so it can build its partial indexes and grants.

  -- PR outcome stats (Feature 1)
  DO \$\$ BEGIN
    ALTER TABLE lore.repos ADD COLUMN outcome_stats JSONB DEFAULT '{}';
  EXCEPTION WHEN duplicate_column THEN NULL;
  END \$\$;

  GRANT USAGE ON SCHEMA lore TO lore;
  GRANT ALL ON ALL TABLES IN SCHEMA lore TO lore;
  ALTER DEFAULT PRIVILEGES IN SCHEMA lore GRANT ALL ON TABLES TO lore;
"
echo "[lore] Repos schema created."
