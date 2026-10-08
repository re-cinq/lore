-- 0106_billing_mode_station_runs: records the actual billing mode per run on
-- pipeline.station_runs so the spend page's Billing Source split can classify
-- API-key vs subscription calls from the recorded fact rather than from the
-- cluster proxy.
--
-- billing_mode is the credential the run used at dispatch time:
--   'api'          — org ANTHROPIC_API_KEY (bills the org account)
--   'subscription' — personal CLAUDE_CODE_OAUTH_TOKEN (bills the runner's own account)
--   'unknown'      — not yet recorded (all historical rows; the cluster-attribution
--                    fallback covers them until the write path is wired in)
--
-- The column is NOT NULL with 'unknown' as the default so historical rows and any
-- row the write path has not yet reached are covered by the fallback rule already
-- implemented in SpendBillingSource.tsx.

ALTER TABLE pipeline.station_runs
  ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'unknown'
    CHECK (billing_mode IN ('api', 'subscription', 'unknown'));
