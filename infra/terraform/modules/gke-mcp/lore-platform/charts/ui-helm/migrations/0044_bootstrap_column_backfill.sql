-- 0044_bootstrap_column_backfill: the last five columns that only ever existed
-- in a baseline setup-*.sh, closing the class 0043 opened.
--
-- 0043 backfilled the ten pipeline.tasks columns after the Floor crash-looped
-- on `dark_factory_overrides` (42703, 2026-08-20). `scripts/check-bootstrap-
-- columns.mjs` now enumerates every `ALTER TABLE … ADD COLUMN` in the baseline
-- scripts and fails when no migration provides it; these five are what it found
-- still uncovered. Both are read through a MODEL's column map, so both are one
-- generated SELECT away from the failure 0043 fixed:
--
--   lore.repos.outcome_stats   — bound by REPO_COLUMNS
--   memory.facts.valid_from    — bound by FACT_COLUMNS, and `valid_to` is read
--   memory.facts.valid_to        by every memory search (the live-fact filter)
--   memory.facts.invalidated_by
--   memory.facts.episode_id
--
-- OWNERSHIP splits the file in two. `lore` owns the `lore` schema, so the repos
-- column applies through the normal channel. The `memory` schema is created by
-- the bootstrap superuser (setup-memory-schema.sh runs `psql -U postgres`), so
-- postgres owns memory.facts and the runner holds GRANT but not the ownership an
-- ALTER needs — the same caveat 0012 and 0013 carry, handled the same way: a
-- subtransaction that catches insufficient_privilege and skips with a NOTICE
-- rather than failing the deploy. Where lore owns the tables it converges by
-- itself; on a superuser-owned cluster, converge by re-running the idempotent
-- setup-memory-schema.sh as the superuser, which declares all of this.
--
-- Idempotent: safe to re-run.

ALTER TABLE lore.repos
  ADD COLUMN IF NOT EXISTS outcome_stats JSONB DEFAULT '{}';

DO $migrate$
BEGIN
  -- Temporal validity (ADR-016): a fact is live while valid_to is null, and a
  -- contradiction sets it and points invalidated_by at the fact that replaced
  -- it. memory-search.ts filters on valid_to on every call.
  ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ NOT NULL DEFAULT now();
  ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS valid_to TIMESTAMPTZ;
  ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS invalidated_by UUID;
  ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS episode_id UUID;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'skip memory.facts temporal columns (runner is not the table owner); run setup-memory-schema.sh as the superuser to converge';
END$migrate$;
