-- The per-task dark-factory override block (FR3.6) existed only in the baseline
-- `scripts/infra/setup-dark-factory-schema.sh`, which an operator runs once when
-- provisioning a cluster. Nothing carried it to a cluster provisioned before that
-- script grew the column, and the Helm hook only applies the files in this
-- directory.
--
-- That stayed harmless while the column was read by dark-factory paths alone.
-- #1410 made `dark_factory_overrides` a member of PIPELINE_TASK_COLUMNS, so every
-- statement built from that list selects it — including `claimNextPending`, the
-- Floor task worker's poll. On a cluster missing the column the worker's first
-- poll raised 42703, the rejection went unhandled, and the Floor exited: a
-- crash-loop that took the webhook ingress down with it (`replicaCount: 1`) and
-- red-failed the next push to main.
--
-- Existing rows keep NULL, which is exactly what `resolveSettings()` reads as
-- "no per-task override" — the same value every row carried before this ran.
ALTER TABLE pipeline.tasks
  ADD COLUMN IF NOT EXISTS dark_factory_overrides JSONB DEFAULT NULL;
