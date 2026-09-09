-- 0059_ingest_state: the incremental CI ingest's commit pointer
-- (specs/ci-incremental-ingest FR1).
--
-- One row per (repo, kind): the commit whose delta was last projected into
-- the spec-traceability graph. CI reads it (GET /api/repos/:o/:r/ingest-state),
-- diffs against it, posts only the delta, and the ingest route advances it
-- with a compare-and-set — so the column is the CAS target, not a log; history
-- is not kept because the graph itself is the durable outcome and a lost
-- pointer merely triggers one full re-ingest.

CREATE TABLE IF NOT EXISTS pipeline.ingest_state (
  repo       text        NOT NULL,
  kind       text        NOT NULL,
  commit_sha text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo, kind)
);
