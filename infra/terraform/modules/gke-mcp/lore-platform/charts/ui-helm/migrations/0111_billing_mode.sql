-- Migration 0111: billing_mode per station run, propagated to llm_calls.
-- station_runs carries the dispatch-time credential type; llm_calls joins it at write time.
ALTER TABLE pipeline.station_runs ADD COLUMN IF NOT EXISTS billing_mode TEXT;
ALTER TABLE pipeline.llm_calls    ADD COLUMN IF NOT EXISTS billing_mode TEXT;
