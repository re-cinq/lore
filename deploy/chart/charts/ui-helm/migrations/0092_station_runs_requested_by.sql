-- 0092_station_runs_requested_by: who ran a visit by hand (specs/fork-rerun-from-node FR8).
--
-- "Run this station" starts the next iteration of a node inside the SAME run
-- instead of a fresh run. The visit it launches names the person here; the
-- walk replay restarts at the newest such visit, so the rows before it number
-- later iterations but no longer route the walk or spend a retry budget.
-- NULL on every visit the walk launched itself.

ALTER TABLE pipeline.station_runs
  ADD COLUMN IF NOT EXISTS requested_by TEXT;
