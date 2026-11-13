-- 0008_drop_v2_spec_coverage_tables: drop the v2 persistence tables.
--
-- v3 of spec-test-coverage (2026-06-02) puts the source of truth for
-- spec→test linkage into markdown links inside spec.md itself. The
-- web UI parses them at render time; the cron writes its findings
-- as PR edits + comments. No reader of these tables remains:
--
--   * /api/repos/:o/:r/spec-coverage             (deleted)
--   * /api/repos/:o/:r/spec-coverage/stale       (deleted)
--   * /api/repos/:o/:r/spec-coverage/prepare     (deleted)
--   * /api/repos/:o/:r/spec-coverage/persist     (deleted)
--   * web-ui per-repo specs page (now reads chunks only)
--   * agent linker (now writes PRs, not rows)
--
-- Migrations 0002, 0004, 0005, 0006, 0007 remain on disk as
-- historical record (no destructive rewrite of migration history),
-- but the tables they created are dropped here.
--
-- Same per-team-schema discovery + GRANT pattern as 0002 / 0004 /
-- 0005 / 0006 / 0007. Idempotent: safe to re-run.
-- CASCADE drops the BIGSERIAL sequence + indexes alongside.

DO $$
DECLARE
  s TEXT;
BEGIN
  FOR s IN
    SELECT n.nspname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname IN ('spec_test_links', 'spec_statements', 'spec_coverage_runs')
      AND c.relkind = 'r'
    GROUP BY n.nspname
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I.spec_test_links CASCADE', s);
    EXECUTE format('DROP TABLE IF EXISTS %I.spec_statements CASCADE', s);
    EXECUTE format('DROP TABLE IF EXISTS %I.spec_coverage_runs CASCADE', s);
  END LOOP;
END$$;
