-- 0037_agent_run_turns: the full-fidelity turn-level transcript store
-- (specs/turn-level-transcript-store, superseding ADR-042).
--
-- pipeline.agent_run_events is a deliberate PROJECTION: the Floor route
-- truncates a tool result at 2048 bytes and each tool-input value at 1024
-- before writing, and prunes at 14 days. That is right for its consumer (the
-- SSE live run view, ADR-037) and wrong for a post-mortem. The raw NDJSON is
-- archived to GCS with no read path. This table is the sibling that keeps the
-- UNTRUNCATED envelope, correlated the same way, readable with SQL.
--
-- NO FOREIGN KEYS -- deliberate, exactly as in 0031, and for the same reason:
--   * task_id is TEXT and nullable. Turns arrive for task ids that are not yet
--     (or never) in pipeline.tasks, and ingest is a batch insert -- one bad row
--     under a FK aborts the whole statement and drops the batch. Nullable goes
--     one step further than 0031's NOT NULL: a line the subsystem never
--     attributed to a task is still stored, because a store whose whole point
--     is fidelity must not drop lines it cannot label.
--   * assembly_line_id carries no FK so pruning old assembly lines never
--     cascade-blocks or cascade-deletes transcripts. Orphans are acceptable;
--     the created_at prune is the reaper for all of them.
--
-- id is a bigint identity and doubles as the read cursor. It exceeds
-- Number.MAX_SAFE_INTEGER, so every reader carries it as a string.
--
-- Retention is 30 days (pipeline.agent_run_events prunes at 14). The table
-- exists precisely for questions asked after the live view has moved on, but
-- there is no pilot to measure real growth against, so the starting horizon is
-- deliberately conservative and can grow once volume is known.
--
-- The write-time correlation lookup rides pipeline.assembly_line_nodes'
-- agent_cr_name index, created by 0031 -- no new index on a live table here.
--
-- Idempotent: safe to re-run. Created/owned by `lore`; `lore_ui` (web-ui) gets
-- SELECT, guarded like 0009 and 0031, so the deferred turn-view UI needs no
-- further schema change.

CREATE TABLE IF NOT EXISTS pipeline.agent_run_turns (
  id               BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id          TEXT,
  agent_cr_name    TEXT,
  assembly_line_id UUID,
  node_id          TEXT,
  iteration        INT,
  event_type       TEXT,                   -- the raw stream-json line kind, as emitted
  envelope         JSONB        NOT NULL,  -- the untruncated {source, event} line
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- the per-line read: one assembly line, ascending from a cursor
CREATE INDEX IF NOT EXISTS agent_run_turns_line_idx
  ON pipeline.agent_run_turns(assembly_line_id, id) WHERE assembly_line_id IS NOT NULL;

-- the per-task read, the only path to rows that correlate to no node
CREATE INDEX IF NOT EXISTS agent_run_turns_task_idx
  ON pipeline.agent_run_turns(task_id, id) WHERE task_id IS NOT NULL;

-- the retention prune scan
CREATE INDEX IF NOT EXISTS agent_run_turns_created_idx
  ON pipeline.agent_run_turns(created_at);

GRANT ALL ON pipeline.agent_run_turns TO lore;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'GRANT SELECT ON pipeline.agent_run_turns TO lore_ui';
  END IF;
END$$;
