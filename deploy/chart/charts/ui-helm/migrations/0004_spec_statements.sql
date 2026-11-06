-- 0004_spec_statements: per-team-schema segmented-spec-statement table.
--
-- Source of truth for the testable/untestable state of EVERY statement of
-- every spec, including statements with no test link -- so the CoverageBar
-- and the "untestable" de-emphasis can be rendered without re-segmenting
-- at render time. Written by the agent's spec-test-linker job after a
-- spec's content hash changes; read by the per-repo specs page and the
-- spec-coverage API.
--
-- Mirrors the 0002 discovery model: one table per schema that holds a
-- chunks table, discovered via pg_catalog (NOT information_schema --
-- privilege-filtered listings would silently hide schemas lore has no
-- grant on). The migration runner is 'lore' and must have CREATE on each
-- schema (granted by setup-db.sh / the README handoff).
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
      CREATE TABLE IF NOT EXISTS %I.spec_statements (
        id            BIGSERIAL PRIMARY KEY,
        repo          TEXT NOT NULL,
        spec_path     TEXT NOT NULL,
        ordinal       INTEGER NOT NULL,
        text          TEXT NOT NULL,
        kind          TEXT NOT NULL,
        testability   TEXT NOT NULL,
        category      TEXT,
        classified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (repo, spec_path, ordinal)
      )', s);
    EXECUTE format('
      CREATE INDEX IF NOT EXISTS %I_spec_statements_spec_idx
      ON %I.spec_statements (repo, spec_path)', s, s);
    EXECUTE format('GRANT ALL ON %I.spec_statements TO lore', s);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I.spec_statements_id_seq TO lore', s);
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
      EXECUTE format('GRANT SELECT ON %I.spec_statements TO lore_ui', s);
    END IF;
  END LOOP;
END$$;
