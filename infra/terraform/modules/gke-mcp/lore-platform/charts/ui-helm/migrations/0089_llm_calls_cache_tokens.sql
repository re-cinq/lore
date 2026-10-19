-- 0089_llm_calls_cache_tokens: record prompt-cache usage per LLM call (#2116).
--
-- Claude runs read most of their input from the prompt cache, and the usage
-- line every run reports carries it (`cache_read_input_tokens`,
-- `cache_creation_input_tokens`), but pipeline.llm_calls kept only the
-- uncached input and the output, so /spend could not show it.
--
-- Default 0 so every existing row and every writer that reports no cache usage
-- (Gemini, failed calls) stays valid without a backfill.
--
-- Idempotent: safe to re-run.

ALTER TABLE pipeline.llm_calls ADD COLUMN IF NOT EXISTS cache_read_tokens  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pipeline.llm_calls ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER NOT NULL DEFAULT 0;
