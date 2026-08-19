-- 0041_agent_run_turns_dedup: re-ingest idempotency for the turn store (#1389).
--
-- The task-turns relay (POST /api/task-turns/{taskId}, lore-api) re-receives
-- the SAME transcript lines whenever the local runner re-POSTs its buffer
-- (network flake, restart, a retry after a lost ack): the GCS path it replaced
-- was idempotent by object overwrite; the relay was append-only. The relay now
-- stamps each relayed line's envelope with a `turn_key` (sha256 over task id +
-- transcript position + line bytes); the Floor's collector carries it into
-- dedup_key, and the adapter inserts with a BARE `ON CONFLICT DO NOTHING` --
-- deliberately no arbiter target, so a database missing this index (migrations
-- disabled) degrades to duplicates rather than 42P10-failing every batch,
-- which would be total turn loss.
--
-- dedup_key is NULL for every non-relay producer (cluster pods): the partial
-- unique index never applies to them, so the store's fidelity property --
-- never drop a line it cannot label -- is untouched on the live ingest path.
--
-- agent_run_turns_dedup_idx below is a NON-CONCURRENT CREATE UNIQUE INDEX on
-- pipeline.agent_run_turns, a live table holding a 30-day horizon of
-- untruncated envelopes: the build heap-scans the table under a SHARE lock
-- even though the new column is all-NULL at build time (the index itself
-- starts empty, so no 0029-style duplicate cleanup is needed). The migration
-- hook blocks the umbrella deploy for the build's duration; anyone applying
-- this to a materially larger deployment should build it CONCURRENTLY by hand
-- first, which makes the statement below a no-op.
--
-- Idempotent: safe to re-run. `lore` owns the table and 0037's table-level
-- grants cover new columns, so no further grants are needed.

ALTER TABLE pipeline.agent_run_turns
  ADD COLUMN IF NOT EXISTS dedup_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS agent_run_turns_dedup_idx
  ON pipeline.agent_run_turns(dedup_key) WHERE dedup_key IS NOT NULL;
