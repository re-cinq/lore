-- 0033_backfill_line_keyed_costs: recover the cost of task-less assembly-line
-- runs from the run-viz telemetry.
--
-- Until 0032 dropped the llm_calls task FK, the cost row of every task-less
-- line's agent pod (code-review, comment-triage) was rejected at ingest and
-- lost. The same terminal `result` line was ALSO projected into
-- pipeline.agent_run_events (event_type 'result', payload {costUsd,
-- durationMs}) — 14-day retention, so the recent history is recoverable from
-- there. This inserts one llm_calls row per surviving result event whose
-- task_id is an assembly line with no backing task (the exact FK-rejected
-- family; task-backed runs already have their rows via the sink).
--
-- job_name 'agent-backfill' marks the provenance; the run-events payload
-- carries no token counts, so those are 0. created_at is preserved from the
-- event so /spend and /analytics bucket the cost into the right days. Runs
-- older than the run-events retention window are gone (no archive bucket was
-- configured) and stay em-dash.
--
-- Idempotent: the NOT EXISTS guard skips lines that already have any
-- llm_calls rows, so a re-run inserts nothing.

INSERT INTO pipeline.llm_calls
  (task_id, job_name, model, input_tokens, output_tokens, cost_usd, duration_ms, created_at)
SELECT are.task_id::uuid,
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
     SELECT FROM pipeline.llm_calls lc WHERE lc.task_id = al.id
   );
