-- 0042_station_runs_failure: record WHY a station run failed, not just THAT it did.
--
-- The problem this fixes (#1455). On 2026-08-20 the Anthropic account behind the
-- agent pods ran dry. Every LLM pod exited 1 printing `Credit balance is too low`,
-- and the author of a feature-planning round was told:
--
--   AssemblyLine feature-planning: edge analyze->analyze exceeded iteration_max 1
--
-- A true statement about the WALK that says nothing about the CAUSE. The cause was
-- never written down anywhere durable: `finishStationRunOnce` persisted only the
-- outcome string, so the agent's own error text lived exclusively in the Agent CR
-- (pruned ~1h after terminal) and the pod (garbage-collected). An hour later the
-- run was undiagnosable from Lore's own data, and answering "why did this fail"
-- meant reaching for kubectl.
--
-- `failure_class` is the shared FailureCategory (libs/shared/src/error-classify.ts)
-- the Floor derived from the pod's terminal text — `anthropic-credit`, `auth`,
-- `infra`, and so on. `failure_detail` is that text, capped at 300 chars upstream.
-- Together they are what lets the walk refuse to spend a retry budget on a failure
-- no retry can clear, and what lets the line's terminal reason name the cause.
--
-- Both nullable, deliberately: a successful visit has no failure, and every visit
-- recorded before this migration has one that was thrown away. A NULL here means
-- "not classified", never "classified as fine" — readers must not infer success.
--
-- No DEFAULT: 0040 already warns that ADD COLUMN with a volatile default rewrites
-- station_runs, and a plain NULL default is a metadata-only change on PG 11+.
-- Idempotent: safe to re-run.

ALTER TABLE pipeline.station_runs
  ADD COLUMN IF NOT EXISTS failure_class TEXT,
  ADD COLUMN IF NOT EXISTS failure_detail TEXT;

-- No backfill is possible or honest. The text these columns hold only ever existed
-- in Kubernetes objects that have since been pruned; inventing a class for historic
-- rows would put a guess where the schema promises an observation.

-- "What is failing across the factory right now, and why" — the read behind the
-- account-wide outage signal, which asks for recent failures of one class. Partial
-- so it costs nothing for the overwhelming majority of rows, which are successes.
CREATE INDEX IF NOT EXISTS station_runs_failure_class_idx
    ON pipeline.station_runs (failure_class, finished_at DESC)
 WHERE failure_class IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON pipeline.station_runs TO lore;
