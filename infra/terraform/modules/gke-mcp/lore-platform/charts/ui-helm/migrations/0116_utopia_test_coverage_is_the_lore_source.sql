-- 0116_utopia_test_coverage_is_the_lore_source: a base's old `lore` statements source becomes its
-- `test-coverage` source (specs/utopia-graph-mirror FR19).
--
-- The `lore` source already holds the statement, test and code items `test-coverage` takes, and
-- Utopia refuses a second document with the same content in a base (FR18.6). Purging the old items
-- is a delete and a purge per document, each a pass over the whole base's facts, so a base of tens
-- of thousands cannot be emptied in days. Pointing `test-coverage` at the source that holds them
-- moves nothing: the items a repo pushes again come back `unchanged`, and the issue, commit, pull
-- request, tag, release and document items the text sources replaced are the only ones left over.
--
-- A repo that already made a newer `test-coverage` source (the first push after 0114) is pointed
-- at the old one too; the newer one keeps what it holds and is no longer pushed to. Only the
-- `lore` role reads either table. Idempotent: it writes what lore.utopia_sources holds.

INSERT INTO lore.utopia_kind_sources (repo, kind, kb_id, source_id, source_key)
SELECT repo, 'test-coverage', kb_id, source_id, source_key
  FROM lore.utopia_sources
ON CONFLICT ((lower(repo)), kind) DO UPDATE
  SET kb_id = EXCLUDED.kb_id,
      source_id = EXCLUDED.source_id,
      source_key = EXCLUDED.source_key,
      updated_at = now();
