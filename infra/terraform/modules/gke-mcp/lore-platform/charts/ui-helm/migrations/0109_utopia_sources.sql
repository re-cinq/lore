-- 0109_utopia_sources: the per-repo Utopia push source and its key (specs/utopia-graph-mirror, ADR-052).
-- The key is a credential, so it lives here and not in lore.repos.settings, which read-scope routes serve whole.
-- Only lore (lore-api) may read it; lore_ui is never granted, and is revoked in case a hand grant exists.

CREATE TABLE IF NOT EXISTS lore.utopia_sources (
  repo        TEXT PRIMARY KEY,
  kb_id       TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  source_key  TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS utopia_sources_repo_lower_idx
  ON lore.utopia_sources (lower(repo));

GRANT ALL ON lore.utopia_sources TO lore;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'REVOKE ALL ON lore.utopia_sources FROM lore_ui';
  END IF;
END$$;
