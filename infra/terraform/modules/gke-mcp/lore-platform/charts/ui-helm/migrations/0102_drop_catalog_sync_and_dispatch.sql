-- 0102_drop_catalog_sync_and_dispatch: Lore's cluster agent is deleted (its
-- charts, its lore-api routes, its app and the shared code behind them, on
-- 2026-10-02), and with it the two mechanisms these stored:
--
--   * the catalog sync: every agent-definition write queued a row in
--     lore.catalog_events for the agent to read, each agent kept its place in
--     pipeline.cluster_agents.catalog_cursor, and reported what it did into
--     lore.catalog_apply_status;
--   * the claim: a station run carried the recipe to launch (dispatch_spec)
--     and how often its launch had been handed back (launch_attempts), and the
--     claim query scanned station_runs_claim_scan.
--
-- Nothing writes or reads any of it any more. pipeline.cluster_agents itself
-- and station_runs.cluster_agent_id stay: the Spend page and the run page read
-- them for the runs Lore's own Floor walked.

DROP TABLE IF EXISTS lore.catalog_apply_status;
DROP TABLE IF EXISTS lore.catalog_events;

ALTER TABLE pipeline.cluster_agents DROP COLUMN IF EXISTS catalog_cursor;

DROP INDEX IF EXISTS pipeline.station_runs_claim_scan;

ALTER TABLE pipeline.station_runs
  DROP COLUMN IF EXISTS dispatch_spec,
  DROP COLUMN IF EXISTS launch_attempts;
