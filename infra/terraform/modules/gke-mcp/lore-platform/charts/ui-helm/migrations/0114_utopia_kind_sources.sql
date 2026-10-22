-- 0114_utopia_kind_sources: one Utopia source per mirrored kind and repo (specs/utopia-graph-mirror FR18).
--
-- A repo's knowledge base holds a source for each kind of thing Lore mirrors into it: `docs`,
-- `git-history` and `github` are `api` sources that take whole text documents, `test-coverage`
-- is a `statements` source. This table holds each source's id and push key, one row per repo
-- and kind, so the kinds are told apart in Utopia the way `memories` and `episodes` are (0110).
-- Like lore.utopia_sources (0109) it holds credentials: only lore (lore-api) may read it.
--
-- Idempotent: IF NOT EXISTS. Runs as `lore`, the owner of the lore schema.

CREATE TABLE IF NOT EXISTS lore.utopia_kind_sources (
  repo        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('docs', 'test-coverage', 'git-history', 'github')),
  kb_id       TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  source_key  TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS utopia_kind_sources_repo_kind_idx
  ON lore.utopia_kind_sources (lower(repo), kind);

GRANT ALL ON lore.utopia_kind_sources TO lore;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'REVOKE ALL ON lore.utopia_kind_sources FROM lore_ui';
  END IF;
END$$;
