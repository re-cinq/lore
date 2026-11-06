-- 0002_spec_test_links: per-team-schema spec -> test linkage table.
--
-- Written by the agent's spec-test-linker job (one confirmed (spec, test)
-- link per row); read by GET /api/repos/:owner/:repo/spec-coverage and the
-- per-repo specs page. Mirrors chunks isolation: one table per schema that
-- holds a chunks table (every team schema + org_shared), so the set is
-- discovered dynamically rather than hardcoded -- any schema added since
-- setup-db.sh is covered, and schemas added later are picked up on the next
-- deploy's migration re-run.
--
-- Discovery uses pg_catalog, NOT information_schema: this runs as the 'lore'
-- role (the migration runner), and information_schema.tables is privilege-
-- filtered, so it would silently hide chunks tables lore has no grant on and
-- the loop would create nothing. pg_catalog lists them regardless of grants.
-- 'lore' still needs CREATE on each schema (granted by setup-db.sh / the
-- one-time handoff in README.md).
--
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
      CREATE TABLE IF NOT EXISTS %I.spec_test_links (
        id           BIGSERIAL PRIMARY KEY,
        repo         TEXT NOT NULL,
        spec_path    TEXT NOT NULL,
        test_file    TEXT NOT NULL,
        test_name    TEXT NOT NULL,
        test_line    INTEGER,
        symbol       TEXT,
        match_kind   TEXT NOT NULL,
        rationale    TEXT NOT NULL,
        linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (repo, spec_path, test_file, test_name)
      )', s);
    EXECUTE format('
      CREATE INDEX IF NOT EXISTS %I_spec_test_links_spec_idx
      ON %I.spec_test_links (repo, spec_path)', s, s);
    EXECUTE format('
      CREATE INDEX IF NOT EXISTS %I_spec_test_links_test_idx
      ON %I.spec_test_links (repo, test_file)', s, s);
    EXECUTE format('GRANT ALL ON %I.spec_test_links TO lore', s);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I.spec_test_links_id_seq TO lore', s);
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
      EXECUTE format('GRANT SELECT ON %I.spec_test_links TO lore_ui', s);
    END IF;
  END LOOP;
END$$;
