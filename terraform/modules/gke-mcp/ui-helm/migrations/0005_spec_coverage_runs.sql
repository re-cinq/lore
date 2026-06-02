-- 0005_spec_coverage_runs: per-team-schema content-hash freshness gate.
--
-- The spec-test-linker job hashes reassembleSpec() output for each spec
-- chunk and skips the spec entirely when its hash is unchanged since the
-- last successful run -- so an edited spec re-links promptly while the
-- weekly sweep over unchanged specs costs zero LLM calls.
--
-- Same per-team-schema discovery + GRANT pattern as 0002 / 0004.
-- Idempotent: safe to re-run.

DO $$
DECLARE
  s TEXT;
BEGIN
  FOR s IN
    SELECT n.nspname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chunks' AND c.relkind = 'r'
  LOOP
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.spec_coverage_runs (
        repo         TEXT NOT NULL,
        spec_path    TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        run_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (repo, spec_path)
      )', s);
    EXECUTE format('GRANT ALL ON %I.spec_coverage_runs TO lore', s);
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
      EXECUTE format('GRANT SELECT ON %I.spec_coverage_runs TO lore_ui', s);
    END IF;
  END LOOP;
END$$;
