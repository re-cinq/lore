-- 0053_catalog_events: the catalog sync substrate (DB-first agent catalog).
--
-- lore.catalog_events is an append-only, multi-reader change log over
-- lore.agent_definitions: every create/update/delete appends one row, and every
-- registered cluster-agent tails it independently (its own cursor) to apply the
-- AgentDefinition/Station CRD pair to ITS cluster. Fan-out, so deliberately NOT
-- pipeline.events (single-consumer FOR UPDATE SKIP LOCKED) and NOT
-- pipeline.event_deliveries (static pre-registered subscriber set — a
-- cluster-agent registers dynamically and needs full current state, not a tail
-- from subscription time). Shape follows agent_run_events: monotonic id, read
-- via `id > cursor ORDER BY id`.
--
-- A row carries NO payload: it is a pointer meaning "re-resolve (name,
-- project_id) and apply what you find". Rapid successive writes collapse
-- naturally — the reader of event N+1 already applied the current row, so the
-- replay of N is a no-op. `op` is a logging hint, never branched on: the reader
-- always re-resolves, and a resolve that comes back empty means delete the CRDs.

CREATE TABLE IF NOT EXISTS lore.catalog_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  -- NULL = org default. Deliberately no FK (the agent_run_events precedent):
  -- an event must survive repo deletion — the reader's re-resolve then finds
  -- nothing and deletes the CRDs, which is exactly the right outcome.
  project_id  UUID,
  op          TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Each cluster-agent's high-water mark over lore.catalog_events. NULL means
-- "never resynced": the catalog-events endpoint answers with a full snapshot
-- of every current (name, project_id) definition instead of a tail, which is
-- how a freshly-registered cluster gets the whole catalog before its claim
-- loop is allowed to create the first Agent CR.
ALTER TABLE pipeline.cluster_agents
  ADD COLUMN IF NOT EXISTS catalog_cursor BIGINT;

-- The recipe fields the Helm catalog seed carried that never had a column:
-- task types' skills / disallowed_tools / watch / repo_workdir, stations'
-- command / env / pod_labels / needs_model. One JSONB column rather than eight
-- typed ones because the set is owned by TaskTypeConfigSchema /
-- StationConfigSchema (libs/shared/src/task-types/task-types-config.ts) and
-- validated at the API edge; the DB stores, the code interprets.
ALTER TABLE lore.agent_definitions
  ADD COLUMN IF NOT EXISTS config JSONB;
