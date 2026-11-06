-- 0069_test_reports: the latest lore-code-trace test report per repo+commit,
-- the substrate the run page's Definition-of-Done panel reads
-- (specs/implementation-loop FR16).
--
-- The Floor's POST /api/webhook/ci-tests already turns every report into an
-- internal.ingest.spec_trace event for the traceability graph; that event is
-- consumed and gone. This table keeps the last report itself, so a run can
-- ask "which of my acceptance tests are green on my branch" without a graph.
--
-- One row per (repo, commit): re-posting a commit replaces its row rather than
-- stacking a second one. The branch index serves the "latest on this branch"
-- read. No FKs, deliberately: a report may arrive for a branch no run owns.
--
-- Idempotent: safe to re-run. Created/owned by `lore`; `lore_ui` gets SELECT,
-- guarded like 0009.

CREATE TABLE IF NOT EXISTS pipeline.test_reports (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo        TEXT        NOT NULL,
  commit      TEXT        NOT NULL,
  branch      TEXT        NOT NULL,
  tests       JSONB       NOT NULL,
  outcomes    JSONB       NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo, commit)
);

-- the "latest report on this branch" read
CREATE INDEX IF NOT EXISTS test_reports_branch_idx
  ON pipeline.test_reports(repo, branch, received_at DESC);

GRANT ALL ON pipeline.test_reports TO lore;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'GRANT SELECT ON pipeline.test_reports TO lore_ui';
  END IF;
END$$;
