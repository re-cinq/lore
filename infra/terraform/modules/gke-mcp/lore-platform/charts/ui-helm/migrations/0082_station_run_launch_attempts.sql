-- 0082_station_run_launch_attempts: a visit no cluster can launch fails itself
-- instead of blocking the claim queue (#2006).
--
-- On 2026-09-12 and three times on 2026-09-14 one visit for the renamed
-- repository re-cinq/HAL-engine could not launch: the GitHub App refused to mint
-- a token for the old name. The cluster-agent handed the visit back, lore-api
-- requeued the same row, and the claim (ORDER BY id) gave it to the next poll
-- again, every fifteen seconds. Nothing behind it was ever claimed, so a code
-- review and an implementation round were reaped as "may be wedged" thirty
-- minutes later.
--
-- `launch_attempts` counts hand-backs. lore-api's release fails the visit once
-- the count reaches LORE_STATION_LAUNCH_ATTEMPTS (default 3), or at once when the
-- launch error is a permanent class, and the claim orders by it first, so a visit
-- that has bounced is taken after fresh work rather than before it.
--
-- A constant DEFAULT is a metadata-only change on PG 11+. Idempotent.

ALTER TABLE pipeline.station_runs
  ADD COLUMN IF NOT EXISTS launch_attempts integer NOT NULL DEFAULT 0;
