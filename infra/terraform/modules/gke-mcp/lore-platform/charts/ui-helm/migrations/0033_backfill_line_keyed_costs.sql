-- 0033_backfill_line_keyed_costs: recover the cost of task-less assembly-line
-- runs from the run-viz telemetry into the new assembly_line_id column (0032).
--
-- Before 0032 the cost row of every task-less line's agent pod (code-review,
-- comment-triage) was rejected at ingest by the task FK and lost. The same
-- terminal `result` line was ALSO projected into pipeline.agent_run_events
-- (event_type 'result', payload {costUsd, durationMs}) — 14-day retention, so
-- the recent history is recoverable from there. This inserts one llm_calls row
-- per surviving result event whose task_id is a task-less assembly line
-- (al.task_id IS NULL), keyed by assembly_line_id with a NULL task_id (the FK
-- family). Task-backed runs never lost their rows, so they are not backfilled.
--
-- job_name 'agent-backfill' marks the provenance; the run-events payload
-- carries no token counts, so those are 0. created_at is preserved from the
-- event so /spend and /analytics bucket the cost into the right days. Runs
-- older than the run-events retention window are gone (no archive bucket was
-- configured) and stay em-dash.
--
-- Idempotent: the NOT EXISTS guard skips lines that already have an
-- assembly_line_id-keyed row, so a re-run inserts nothing.

INSERT INTO pipeline.llm_calls
  (task_id, assembly_line_id, job_name, model, input_tokens, output_tokens, cost_usd, duration_ms, created_at)
SELECT NULL,
       al.id,
       'agent-backfill',
       'unknown',
       0,
       0,
       COALESCE((are.payload->>'costUsd')::numeric, 0),
       COALESCE((are.payload->>'durationMs')::int, 0),
       are.created_at
  FROM pipeline.agent_run_events are
  JOIN pipeline.assembly_lines al
    ON are.task_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND al.id = are.task_id::uuid
   AND al.task_id IS NULL
 WHERE are.event_type = 'result'
   AND NOT EXISTS (
     SELECT FROM pipeline.llm_calls lc WHERE lc.assembly_line_id = al.id
   );
