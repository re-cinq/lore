-- 0060_gcp_cost_daily: cache table for the authoritative GCP spend shown on
-- the web-ui /spend page beside the Kubernetes ESTIMATE.
--
-- The gcp-cost-sync station (apps/stations/src/stations/gcp-cost-sync/) reads
-- the Cloud Billing BigQuery export for a trailing 31-day window and upserts
-- one row per (bucket_date, service.description). cost_usd is the gross list
-- cost; credits_usd is the (negative) credit sum for the same bucket — kept
-- separate so the invoice a person reconciles against can be taken apart.
--
-- Google's export is the durable source of truth: the sync re-pulls and
-- upserts daily, so a late restatement self-heals on the next run.
--
-- Idempotent: safe to re-run. Created/owned by `lore`; `lore_ui` (web-ui)
-- gets SELECT, guarded like 0009.

CREATE TABLE IF NOT EXISTS pipeline.gcp_cost_daily (
  bucket_date DATE NOT NULL,
  service     TEXT NOT NULL DEFAULT '',
  cost_usd    NUMERIC NOT NULL DEFAULT 0,
  credits_usd NUMERIC NOT NULL DEFAULT 0,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_date, service)
);

GRANT ALL ON pipeline.gcp_cost_daily TO lore;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'GRANT SELECT ON pipeline.gcp_cost_daily TO lore_ui';
  END IF;
END$$;
