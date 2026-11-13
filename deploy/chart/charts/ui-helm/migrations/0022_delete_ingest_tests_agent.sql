-- 0022_delete_ingest_tests_agent.sql
--
-- Retire the `ingest-tests` graph-ingest agent definition. Test projection is
-- now CI-driven, mirroring specs/ADRs (ADR-023): the repo's lore-tests.yml runs
-- the project's test suite and POSTs /api/repos/:o/:r/test-report + /coverage
-- directly to the coordinator — no pipeline task, no agent definition. The
-- cluster `ingest-tests` task was a self-skipping no-op anyway (the suite runs in
-- CI / a local sandbox, never on the shared agent).
--
-- 0015 seeded this row and is immutable (append-only migrations), so the removal
-- lives here (alongside 0021, which retired ingest-specs/ingest-adrs the same
-- way). Idempotent — a re-run is a no-op once the row is gone. Deletes both the
-- org default (project_id IS NULL) and any per-project override, since the task
-- type no longer exists anywhere. Single-transaction, runs as lore.

DELETE FROM lore.agent_definitions
WHERE name = 'ingest-tests';
