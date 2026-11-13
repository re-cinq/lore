-- 0056_catalog_apply_status: what each cluster did with each catalog entry.
--
-- The sync loop already decides applied / refused / skipped per entry and logs
-- the reason, but a log line dies with the pod. On 2026-09-01 a cluster spent
-- two hours refusing an entry and the only evidence lived in stdout; a
-- satellite refusing every recipe overnight would leave nothing at all behind.
-- The ack cursor answers "how far has this cluster read"; this table answers
-- the question the incident actually asked — "what did it DO with what it
-- read, and if it refused, why".
--
-- One row per (cluster, definition): the CURRENT state, not a history. A retry
-- that succeeds must erase the refusal it replaces, or the page would show a
-- problem that no longer exists — which is worse than showing nothing.
--
-- No FK to lore.agent_definitions (the agent_run_events precedent): a row must
-- survive the definition it describes being deleted, so the delete the cluster
-- applied is still visible afterwards. The cluster_agents FK DOES cascade —
-- an unregistered cluster's verdicts are about a cluster that no longer exists.

CREATE TABLE IF NOT EXISTS lore.catalog_apply_status (
  cluster_agent_id UUID NOT NULL
    REFERENCES pipeline.cluster_agents (id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  -- NULL = the org default, matching lore.agent_definitions' scoping. In the
  -- key below it is COALESCEd, because NULL never equals NULL in a unique
  -- index and every org-default row would otherwise insert a duplicate.
  project_id       UUID,
  state            TEXT NOT NULL CHECK (state IN ('applied', 'refused', 'skipped', 'deleted')),
  -- Why, for the two states a human would ask about. NULL for applied.
  reason           TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The identity, as a unique INDEX rather than a primary key: the key has to
-- COALESCE project_id (see above) and Postgres allows an expression in an
-- index but not in a PRIMARY KEY. `NULLS NOT DISTINCT` would say it more
-- plainly but needs PG15, and this schema still has to apply everywhere the
-- baseline setup scripts run.
CREATE UNIQUE INDEX IF NOT EXISTS catalog_apply_status_identity
  ON lore.catalog_apply_status (
    cluster_agent_id,
    name,
    (COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid))
  );

-- The read the /agents page makes: everything one definition's name resolved
-- to, across every cluster.
CREATE INDEX IF NOT EXISTS catalog_apply_status_by_name
  ON lore.catalog_apply_status (name);
