-- 0052_station_run_terminal_output: where a visit's terminal output LIVES, so
-- the Floor stops fetching it back out of Kubernetes
-- (specs/running-stations-in-any-k8s-cluster FR4).
--
-- The Floor read a finished node's output from its Agent CR, through the one
-- cluster-agent URL it holds. That works only while every node runs in the
-- central cluster. A satellite's CR answers null to that read, and on
-- 2026-08-27 the null was read as "the agent produced nothing": every review on
-- re-cinq/lore failed claiming it "never got far enough to judge the diff",
-- while the agents' own output ended in REVIEW_RESULT:APPROVED.
--
-- A satellite cannot be dialled — it is pull-based and outbound-only, with no
-- URL in this registry by design — so the outcome has to travel WITH the report
-- rather than be fetched after it. This column is where it lands.
--
-- Capped to the tail at write time (capTerminalOutput, 256 KiB): the stream runs
-- to ~1.4MB for a long node, and every parser downstream scans backwards for the
-- terminal result line. Deliberately kept OFF the standard select list — the
-- reaper lists every visit of every open run each minute.

ALTER TABLE pipeline.station_runs
  ADD COLUMN IF NOT EXISTS terminal_output TEXT;
