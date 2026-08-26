-- 0050_station_runs_dispatch_spec: the pieces the stacked review edits added
-- to 0049 AFTER it had already been applied — migrations are skip-by-filename
-- (append-only), so an edited 0049 never re-runs and prod kept the first
-- version: no dispatch_spec column (the claim endpoint 500ed for every
-- satellite), the wider claim-scan predicate, and the cluster_agent_id FK the
-- design later dropped. This brings an already-migrated database to exactly
-- what a fresh 0049 (as merged) produces; every statement is a no-op there.

-- The full dispatch spec a claiming cluster-agent runs with (LoreTaskSpec),
-- written at enqueue. Separate from `input` (the size-bounded human-readable
-- record) because this one is the machine contract and must be complete.
ALTER TABLE pipeline.station_runs
  ADD COLUMN IF NOT EXISTS dispatch_spec JSONB;

-- The claim scan matches the claim query exactly: queued, open, ARMED rows.
DROP INDEX IF EXISTS pipeline.station_runs_claim_scan;
CREATE INDEX IF NOT EXISTS station_runs_claim_scan
  ON pipeline.station_runs (status)
  WHERE outcome IS NULL AND dispatch_spec IS NOT NULL;

-- Correlation id, deliberately no FK (the agent_run_events precedent): the
-- claimant is authenticated against the registry at the API layer, and a
-- claim row must survive registry churn rather than block on it.
ALTER TABLE pipeline.station_runs
  DROP CONSTRAINT IF EXISTS station_runs_cluster_agent_id_fkey;
