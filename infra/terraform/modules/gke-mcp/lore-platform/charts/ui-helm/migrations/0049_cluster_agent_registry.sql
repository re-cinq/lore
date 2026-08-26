-- 0049_cluster_agent_registry: the registry of execution clusters and the
-- station-run lifecycle columns for pull-based dispatch
-- (specs/running-stations-in-any-k8s-cluster).
--
-- pipeline.cluster_agents is the roster: one row per registered cluster-agent,
-- the GitLab Runner model for AI stations. token_hash stores SHA-256 only --
-- the plaintext exists once, in the register response (the api_tokens
-- discipline). status is reaper-owned liveness derived from last_seen_at.
--
-- station_runs gains an explicit lifecycle: 'queued' (written by the launch
-- seam, unclaimed), 'claimed' (a cluster-agent took it), 'running' (the
-- default, and the backfill for every existing row -- which is exactly what
-- the push path meant). status is meaningful only while outcome IS NULL;
-- terminality stays a non-null outcome, so the transition replay's await
-- logic is untouched. claimed_at is the execution clock -- node timeouts are
-- measured from it, never from started_at, which keeps its NOT NULL
-- row-creation meaning (now: enqueue time).

CREATE TABLE IF NOT EXISTS pipeline.cluster_agents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL UNIQUE,
  tags           TEXT[] NOT NULL DEFAULT '{}',
  -- UNIQUE doubles as the index for the per-agent auth lookup on every
  -- heartbeat/claim call; two agents sharing a token would make findByTokenHash
  -- ambiguous anyway.
  token_hash     TEXT NOT NULL UNIQUE,
  registered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'offline')),
  cluster_info   JSONB
);

ALTER TABLE pipeline.station_runs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('queued', 'claimed', 'running')),
  -- Correlation id, deliberately no FK (the agent_run_events precedent): the
  -- claimant is authenticated against the registry at the API layer, and a
  -- claim row must survive registry churn rather than block on it.
  ADD COLUMN IF NOT EXISTS cluster_agent_id UUID,
  ADD COLUMN IF NOT EXISTS required_tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  -- The full dispatch spec a claiming cluster-agent runs with (LoreTaskSpec),
  -- written at enqueue. Separate from `input` (the size-bounded human-readable
  -- record) because this one is the machine contract and must be complete.
  ADD COLUMN IF NOT EXISTS dispatch_spec JSONB;

-- The claim scan: queued, open rows only. Partial so the terminal bulk of the
-- table never enters the index.
CREATE INDEX IF NOT EXISTS station_runs_claim_scan
  ON pipeline.station_runs (status)
  WHERE outcome IS NULL;
