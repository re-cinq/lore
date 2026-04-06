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
  GRANT USAGE ON SCHEMA lore TO lore;
  GRANT ALL ON ALL TABLES IN SCHEMA lore TO lore;
  ALTER DEFAULT PRIVILEGES IN SCHEMA lore GRANT ALL ON TABLES TO lore;
"
echo "[lore] Repos schema created."
