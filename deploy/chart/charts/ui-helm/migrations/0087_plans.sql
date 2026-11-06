-- 0087_plans: plans people and the planning agent write together
-- (@re-cinq/planning-sync, hosted by lore-api; replaces lore.features).
--
-- The library keeps a live plan as a Yjs document and answers JSON derived from
-- it (planning-station ADR-002), so a plan is three tables: its workflow meta
-- (lore.plans), the current document with its projection (lore.plan_state),
-- and every content change as a version (lore.plan_versions). lore-api's
-- PgPlanStore is the one writer, checked against the library's own
-- checkPlanStore contract.
--
-- lore.plan_collab_tokens holds the short-lived tokens a browser opens the
-- collaboration socket with: lore-api mints one for a signed-in user after the
-- web tier has checked their access, and stores only its sha256, so no signing
-- secret is shared between the two.

CREATE TABLE IF NOT EXISTS lore.plans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo             TEXT NOT NULL,
  title            TEXT NOT NULL,
  type             TEXT NOT NULL,
  template_version INT NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'draft',
  approval         JSONB,
  current_version  INT NOT NULL DEFAULT 0,
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plans_repo_updated
  ON lore.plans (repo, updated_at DESC);

CREATE TABLE IF NOT EXISTS lore.plan_state (
  plan_id      UUID PRIMARY KEY REFERENCES lore.plans (id) ON DELETE CASCADE,
  state        BYTEA NOT NULL,
  json         JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lore.plan_versions (
  plan_id      UUID NOT NULL REFERENCES lore.plans (id) ON DELETE CASCADE,
  version      INT NOT NULL,
  reason       TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL,
  content_hash TEXT NOT NULL,
  json         JSONB NOT NULL,
  state        BYTEA NOT NULL,
  PRIMARY KEY (plan_id, version)
);

CREATE TABLE IF NOT EXISTS lore.plan_collab_tokens (
  token_hash TEXT PRIMARY KEY,
  plan_id    UUID NOT NULL REFERENCES lore.plans (id) ON DELETE CASCADE,
  repo       TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  user_name  TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('read', 'write')),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS plan_collab_tokens_expires
  ON lore.plan_collab_tokens (expires_at);
