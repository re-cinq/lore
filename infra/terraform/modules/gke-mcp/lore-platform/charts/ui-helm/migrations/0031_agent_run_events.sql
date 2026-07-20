-- 0031_agent_run_events: per-tool-call agent telemetry, the substrate for the
-- live assembly-line run visualization (specs/assembly-line-run-viz, ADR-037).
--
-- The ai-agent-subsystem supervisor already POSTs the full claude stream-json
-- run output to the Floor at /api/agent-events; today only the terminal
-- `result` line survives, as a pipeline.llm_calls cost row. This table keeps
-- every line, so a run can be replayed and streamed.
--
-- NO FOREIGN KEYS -- deliberate, on both task_id and assembly_line_id:
--   * task_id is TEXT, not a UUID FK to pipeline.tasks. Events arrive for task
--     ids that are not yet (or never) in pipeline.tasks, and the ingest path is
--     a batch insert: one bad row under a FK would abort the whole statement
--     and drop the batch. This matches the skip-not-fail posture the existing
--     agent-events route already takes on FK violations
--     (apps/floor/src/delivery/http/routes/agent-events.ts).
--   * assembly_line_id carries no FK so pruning old assembly lines never
--     cascade-blocks or cascade-deletes telemetry. Orphan rows are acceptable;
--     the created_at prune (14 days) is the reaper for all of them.
--
-- id is a bigint identity and doubles as the SSE cursor (Last-Event-ID). It
-- exceeds Number.MAX_SAFE_INTEGER, so every reader carries it as a string.
--
-- assembly_line_nodes_cr_name_idx below is a NON-CONCURRENT CREATE INDEX on
-- pipeline.assembly_line_nodes, a live table: it takes a brief write lock for
-- the duration of the build. That table is small today and the migration hook
-- runs at deploy time, so this is acceptable here -- but anyone applying this
-- to a materially larger deployment should build it CONCURRENTLY by hand
-- first, which makes the statement below a no-op.
--
-- Idempotent: safe to re-run. Created/owned by `lore`; `lore_ui` (web-ui) gets
-- SELECT, guarded like 0009.

CREATE TABLE IF NOT EXISTS pipeline.agent_run_events (
  id               BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id          TEXT         NOT NULL,
  agent_cr_name    TEXT,
  assembly_line_id UUID,
  node_id          TEXT,
  iteration        INT,
  event_type       TEXT         NOT NULL,  -- init | message | thinking | tool_call | tool_result | result
  tool_name        TEXT,
  tool_use_id      TEXT,
  is_error         BOOLEAN      NOT NULL DEFAULT false,
  file_paths       TEXT[]       NOT NULL DEFAULT '{}',
  summary          TEXT,
  payload          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- the SSE catch-up scan: one line, ascending from a cursor
CREATE INDEX IF NOT EXISTS agent_run_events_line_idx
  ON pipeline.agent_run_events(assembly_line_id, id) WHERE assembly_line_id IS NOT NULL;

-- per-task reads for agents that correlate to no assembly-line node
CREATE INDEX IF NOT EXISTS agent_run_events_task_idx
  ON pipeline.agent_run_events(task_id, id);

-- the retention prune scan
CREATE INDEX IF NOT EXISTS agent_run_events_created_idx
  ON pipeline.agent_run_events(created_at);

-- write-time correlation lookup (source.agent -> node row); no index existed
-- on this column before this migration
CREATE INDEX IF NOT EXISTS assembly_line_nodes_cr_name_idx
  ON pipeline.assembly_line_nodes(agent_cr_name) WHERE agent_cr_name IS NOT NULL;

GRANT ALL ON pipeline.agent_run_events TO lore;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'GRANT SELECT ON pipeline.agent_run_events TO lore_ui';
  END IF;
END$$;
