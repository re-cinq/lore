-- 0009_anthropic_cost_daily: cache table for the authoritative org-wide
-- Claude spend shown on the web-ui /spend page.
--
-- The anthropic_cost_sync cron (agent/src/jobs/cron/anthropic-cost-sync.ts)
-- pulls Anthropic's Admin Cost + Usage reports for a trailing 31-day window
-- and upserts one row per (bucket_date, model). cost_usd is in DOLLARS
-- (the Admin API returns cents-as-string; the parser divides by 100). A row
-- with model = '' holds non-token cost (web_search, code_execution, etc.).
--
-- Anthropic is the durable source of truth: the cron re-pulls and upserts
-- daily, so a parser fix self-heals on the next run -- no raw payload kept.
--
-- Idempotent: safe to re-run. Created/owned by `lore`; `lore_ui` (web-ui)
-- gets SELECT, guarded like 0005.

CREATE TABLE IF NOT EXISTS pipeline.anthropic_cost_daily (
  bucket_date           DATE NOT NULL,
  model                 TEXT NOT NULL DEFAULT '',
  cost_usd              NUMERIC NOT NULL DEFAULT 0,
  input_tokens          BIGINT NOT NULL DEFAULT 0,
  output_tokens         BIGINT NOT NULL DEFAULT 0,
  cache_creation_tokens BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens     BIGINT NOT NULL DEFAULT 0,
  fetched_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_date, model)
);

GRANT ALL ON pipeline.anthropic_cost_daily TO lore;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'GRANT SELECT ON pipeline.anthropic_cost_daily TO lore_ui';
  END IF;
END$$;
