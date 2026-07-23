-- 0032_llm_calls_line_keyed_costs: let task-less assembly-line runs keep their
-- cost rows.
--
-- The Floor launches node Agent CRs with `taskId: row.taskId ?? row.id`
-- (advance.ts), so pods of task-less lines (code-review, comment-triage — the
-- webhook-driven family) post their terminal `result` cost row keyed by the
-- ASSEMBLY LINE id. The inline FK on pipeline.llm_calls.task_id rejected those
-- inserts, and the agent-events sink skips-not-fails, so the cost of every
-- webhook-driven run was silently dropped — the run list's Cost column could
-- never show a value for them. Same shape as 0026 (task_leases holding leases
-- without a backing task), except here the column must hold non-task UUIDs, so
-- the FK goes entirely. The web-ui joins costs via
-- COALESCE(assembly_lines.task_id, assembly_lines.id).
--
-- Idempotent: safe to re-run. The idx_llm_calls_task index stays.

ALTER TABLE pipeline.llm_calls DROP CONSTRAINT IF EXISTS llm_calls_task_id_fkey;
