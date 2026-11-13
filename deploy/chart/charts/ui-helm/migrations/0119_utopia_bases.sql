-- 0119_utopia_bases: the Utopia knowledge base of each base by name (specs/utopia-graph-mirror FR4).
--
-- Setup no longer makes the `lore` statements source: every repo pushes through its kind sources
-- (0114), and 0116 made the old `lore` source each repo's `test-coverage` one. What setup records is
-- the knowledge base alone, here, by the base's name: a repo's full name, or the org memory base's
-- `<org>/memory`, which has no repo row to keep settings in. A repo's settings keep `utopia.kb_id`,
-- which switches its mirror on, and lose `utopia.source_id`, which nothing reads any more.
-- lore.utopia_sources stays until this is live; a later migration drops it.
--
-- Idempotent: IF NOT EXISTS, ON CONFLICT DO NOTHING, and `#-` on a missing path is a no-op. Runs as
-- `lore`, the owner of the lore schema.

CREATE TABLE IF NOT EXISTS lore.utopia_bases (
  name        TEXT NOT NULL,
  kb_id       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS utopia_bases_name_idx
  ON lore.utopia_bases (lower(name));

GRANT ALL ON lore.utopia_bases TO lore;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'REVOKE ALL ON lore.utopia_bases FROM lore_ui';
  END IF;
END$$;

INSERT INTO lore.utopia_bases (name, kb_id)
SELECT repo, kb_id FROM lore.utopia_sources
ON CONFLICT ((lower(name))) DO NOTHING;

UPDATE lore.repos SET settings = settings #- '{utopia,source_id}'
 WHERE settings #> '{utopia,source_id}' IS NOT NULL;
