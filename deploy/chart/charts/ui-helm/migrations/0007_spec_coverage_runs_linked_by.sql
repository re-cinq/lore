-- 0007_spec_coverage_runs_linked_by: attribution column for spec_coverage_runs.
--
-- Records who set the latest content_hash for each spec:
--   'cron'              — weekly K8s CronJob via job-runner
--   'webhook'           — post-ingest fan-out via
--                         /api/trigger/spec-test-linker
--   'local:{agent_id}'  — a developer's Claude session writing through
--                         the BYO-compute MCP tools (specs/local-coverage-linker)
--
-- Nullable + additive (ADD COLUMN IF NOT EXISTS) so pre-existing rows from
-- v1 stay valid; the next linker run for each spec backfills the column.
-- The UI shows a "linked Xh ago by Y" subline only when linked_by != 'cron',
-- so a null degrades gracefully to "no subline" until the next run.
--
-- Same per-team-schema discovery + GRANT pattern as 0002 / 0004 / 0005 / 0006.
-- Idempotent: safe to re-run.

DO $$
DECLARE
  s TEXT;
BEGIN
  FOR s IN
    SELECT n.nspname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'spec_coverage_runs' AND c.relkind = 'r'
  LOOP
    EXECUTE format('
      ALTER TABLE %I.spec_coverage_runs
        ADD COLUMN IF NOT EXISTS linked_by TEXT', s);
  END LOOP;
END$$;
