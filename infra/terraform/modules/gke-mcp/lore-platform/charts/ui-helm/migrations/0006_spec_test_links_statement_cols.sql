-- 0006_spec_test_links_statement_cols: additive statement-level columns on
-- spec_test_links so the v2 statement-level linker can record which single
-- statement each test validates plus the judge's score.
--
-- Nullable + additive (ADD COLUMN IF NOT EXISTS) so pre-existing whole-spec
-- link rows from v1 remain valid -- the linker backfills these columns on
-- the next re-link of a changed spec; legacy rows degrade gracefully in the
-- UI as "list-only" until then. The UNIQUE (repo, spec_path, test_file,
-- test_name) constraint already permits one row per test per spec, so
-- best-match-per-test dedup needs no constraint change.
--
-- Same per-team-schema discovery + GRANT pattern as 0002.
-- Idempotent: safe to re-run.

DO $$
DECLARE
  s TEXT;
BEGIN
  FOR s IN
    SELECT n.nspname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'spec_test_links' AND c.relkind = 'r'
  LOOP
    EXECUTE format('
      ALTER TABLE %I.spec_test_links
        ADD COLUMN IF NOT EXISTS statement_ordinal INTEGER,
        ADD COLUMN IF NOT EXISTS statement_text    TEXT,
        ADD COLUMN IF NOT EXISTS match_score       REAL', s);
    EXECUTE format('
      CREATE INDEX IF NOT EXISTS %I_spec_test_links_stmt_idx
      ON %I.spec_test_links (repo, spec_path, statement_ordinal)', s, s);
  END LOOP;
END$$;
