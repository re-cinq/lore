-- 0099_drop_dark_factory_overrides: `pipeline.tasks.dark_factory_overrides`
-- held per-task overrides of the dark-factory settings, which are gone
-- (migration 0096). No row sets it.
--
-- The task model stopped listing the column one deploy earlier (#2453), so no
-- running service selects it when this runs: a migration is applied before the
-- new pods start, and a column dropped under a pod that still selects it is
-- what crash-looped the Floor on 2026-08-20.

ALTER TABLE pipeline.tasks DROP COLUMN IF EXISTS dark_factory_overrides;
