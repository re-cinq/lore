-- 0046_station_runs_input: record WHAT each visit was asked to do, not only how it went.
--
-- The prompt and description a pod ran on lived only on its Agent CR, which is
-- pruned after the run. An hour later "what was this node given" meant kubectl
-- against an object that no longer existed — the same hole 0042 closed for
-- failure text — and a node fed a stale plan looked exactly like one fed the
-- right plan and reasoning badly.
--
-- Bounded upstream (description 4KB, prompt 16KB, params 4KB). The assembled
-- context is deliberately NOT stored: ~34KB per visit, assembled after this row
-- is minted, and reproducible from the context system.
--
-- Nullable with no DEFAULT (0040's warning: a volatile default rewrites the whole
-- table; a plain NULL add is metadata-only on PG 11+). NULL means "dispatched
-- before 0046", never "no input" — no backfill is possible or honest. Idempotent.
ALTER TABLE pipeline.station_runs
  ADD COLUMN IF NOT EXISTS input JSONB;

GRANT SELECT, INSERT, UPDATE ON pipeline.station_runs TO lore;
