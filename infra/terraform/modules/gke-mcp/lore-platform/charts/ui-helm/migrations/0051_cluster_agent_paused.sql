-- 0051_cluster_agent_paused: an operator-owned "stop giving this cluster work"
-- switch (specs/running-stations-in-any-k8s-cluster FR9).
--
-- Distinct from `status`, which is REAPER-owned liveness derived from
-- last_seen_at: a paused agent is fully alive and keeps heartbeating, so
-- nothing it already holds is requeued and its in-flight runs finish. It just
-- stops being handed new ones. Conflating the two would mean pausing a cluster
-- looked exactly like losing one, and the reaper would yank its work away.
--
-- The alternatives it replaces were both bad: scaling the deployment to zero
-- (an abrupt stop that requeues live work five minutes later) or re-registering
-- with tags nothing matches (a trick, not an operation).

ALTER TABLE pipeline.cluster_agents
  ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT false;
