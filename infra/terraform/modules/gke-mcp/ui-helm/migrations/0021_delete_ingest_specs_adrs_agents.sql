-- 0021_delete_ingest_specs_adrs_agents.sql
--
-- Retire the `ingest-specs` and `ingest-adrs` graph-ingest agent definitions.
-- Specs and ADRs now project into the spec-traceability graph via the CI-driven
-- spec-trace trigger (the repo's lore-ingest.yml fans out per-kind jobs that POST
-- to /api/repos/:o/:r/ingest-graph, which fires a fire-and-forget projection
-- trigger) — no pipeline task, no agent definition (ADR-023). `ingest-tests`
-- stays: it runs the project's test suite, so it needs a runner / CI sandbox.
--
-- 0015 seeded these rows and is immutable (append-only migrations), so the
-- removal lives here. Idempotent — a re-run is a no-op once the rows are gone.
-- Deletes both the org default (project_id IS NULL) and any per-project override,
-- since the task type no longer exists anywhere. Single-transaction, runs as lore.

DELETE FROM lore.agent_definitions
WHERE name IN ('ingest-specs', 'ingest-adrs');
