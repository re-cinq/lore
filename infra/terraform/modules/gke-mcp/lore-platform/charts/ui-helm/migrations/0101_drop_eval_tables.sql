-- 0101_drop_eval_tables: the nightly `eval_runner` and `context_core_builder`
-- jobs and the autoresearch loop were deleted with Lore's own Floor on
-- 2026-10-02, and nothing reads or writes their tables any more.
--
-- Context evals are a nightly GitHub Actions job that asks lore-api (#2443);
-- it keeps no stored baseline, so these are dropped rather than kept empty.

DROP TABLE IF EXISTS pipeline.eval_runs;
DROP TABLE IF EXISTS pipeline.context_core_history;
DROP TABLE IF EXISTS pipeline.research_attempts;
