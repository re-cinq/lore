-- 0010_llm_calls_status_error: record failed LLM calls so they surface on the
-- pipeline task page instead of showing "No LLM calls recorded".
--
-- callLLM / callLLMWithTool (agent/src/anthropic.ts) previously inserted a row
-- only on success and rethrew on failure, so an Anthropic 400 (e.g. credit
-- balance too low) left no trace in pipeline.llm_calls. They now insert a row
-- with status = 'failed' and the error message before rethrowing.
--
-- status defaults to 'success' so existing rows and the unchanged success-path
-- INSERTs keep working unchanged. error is NULL for successful calls.
--
-- Idempotent: safe to re-run. Created/owned by `lore`; `lore_ui` already has
-- SELECT on pipeline.llm_calls (the web-ui reads it on the task page).

ALTER TABLE pipeline.llm_calls ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'success';
ALTER TABLE pipeline.llm_calls ADD COLUMN IF NOT EXISTS error  TEXT;
