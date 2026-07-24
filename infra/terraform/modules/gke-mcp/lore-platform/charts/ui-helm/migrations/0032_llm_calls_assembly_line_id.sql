-- 0032_llm_calls_assembly_line_id: correlate cost rows to their assembly-line
-- run so task-less lines keep their cost.
--
-- The Floor launches node Agent CRs with `taskId: row.taskId ?? row.id`
-- (advance.ts), so a task-less line's pod (code-review, comment-triage — the
-- webhook-driven family) posts its terminal `result` cost row keyed by the
-- ASSEMBLY-LINE id. Written to task_id that violated the inline FK to
-- pipeline.tasks and was skipped at ingest, so the run list's Cost column was
-- always empty for those runs. Rather than drop the FK (which would let task_id
-- hold either a task or a line id), add a dedicated nullable assembly_line_id:
-- the ingest writer (PgUsage.logLlmCall) routes the incoming id to task_id when
-- it is a task and to assembly_line_id when it is a line — write-time
-- correlation mirroring pipeline.agent_run_events. No FK on assembly_line_id;
-- like 0031, skip-not-fail ingest must never abort a batch on a not-yet-visible
-- line. The web-ui cost join prefers assembly_line_id, falling back to task_id
-- for rows predating this column.
--
-- Idempotent: safe to re-run.

ALTER TABLE pipeline.llm_calls ADD COLUMN IF NOT EXISTS assembly_line_id UUID;

CREATE INDEX IF NOT EXISTS idx_llm_calls_assembly_line
  ON pipeline.llm_calls(assembly_line_id) WHERE assembly_line_id IS NOT NULL;
