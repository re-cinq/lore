-- 0130_cloud_cost_provider: one daily cloud-cost table for every cloud an
-- install runs on.
--
-- pipeline.gcp_cost_daily (0060) holds the invoice rows of the cloud under the
-- cluster, shown on /spend. A client on Azure gets the same rows from the
-- azure-cost-sync station (Cost Management), so the table gains a provider
-- column and the provider joins the key. The table keeps its name: renaming it
-- would break every reader for no gain. Existing rows are GCP's.
--
-- Idempotent: safe to re-run.

ALTER TABLE pipeline.gcp_cost_daily
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'gcp';

DO $$
BEGIN
  IF (SELECT array_agg(a.attname::text ORDER BY k.ord)
        FROM pg_constraint c
        CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
       WHERE c.conrelid = 'pipeline.gcp_cost_daily'::regclass
         AND c.contype = 'p') = ARRAY['bucket_date', 'service'] THEN
    ALTER TABLE pipeline.gcp_cost_daily DROP CONSTRAINT gcp_cost_daily_pkey;
    ALTER TABLE pipeline.gcp_cost_daily
      ADD CONSTRAINT gcp_cost_daily_pkey
      PRIMARY KEY (provider, bucket_date, service);
  END IF;
END$$;
