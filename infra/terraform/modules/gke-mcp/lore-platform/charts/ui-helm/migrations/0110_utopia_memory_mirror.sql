-- 0110_utopia_memory_mirror: the Utopia api sources memories and episodes are mirrored through (specs/utopia-graph-mirror FR16, ADR-052 amendment 2026-10-19).
--
-- lore.utopia_memory_sources holds the two `api` sources of each base, `memories` and
-- `episodes`, with their push keys and the walk's cursors. A base is a repo's knowledge base,
-- or `<org>/memory` for rows no onboarded repo owns. That base has no lore.repos row to keep
-- settings on, so the cursors live here. Only lore (lore-api) may read the table: like
-- lore.utopia_sources (0109), it holds credentials.
--
-- The cursor is text: an episode walk's is `<created_at>|<id>` of the last episode pushed, a
-- memory pass's the id of the last memory pushed, NULL between passes. Nothing here touches
-- the memory schema, which `lore` does not own (see 0012).
--
-- Idempotent: IF NOT EXISTS. Runs as `lore`, the owner of the lore schema.

CREATE TABLE IF NOT EXISTS lore.utopia_memory_sources (
  base        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('memories', 'episodes')),
  kb_id       TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  source_key  TEXT NOT NULL,
  cursor      TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS utopia_memory_sources_base_kind_idx
  ON lore.utopia_memory_sources (lower(base), kind);

GRANT ALL ON lore.utopia_memory_sources TO lore;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'REVOKE ALL ON lore.utopia_memory_sources FROM lore_ui';
  END IF;
END$$;
