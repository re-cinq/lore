-- 0017_feature_planning: smart feature-planning lifecycle (drafts + iterations).
--
-- A repo's Features tab browses first-class Feature entities; the smart feature
-- page runs a planning Station (Job pod) per refinement round and persists the
-- structured gap-analysis result here. The draft spec lives in `draft_spec_md`
-- uncommitted until the author finalizes (then it ships as a PR, never a direct
-- main commit). See specs/7-feature-planning/ and ADR-027.
--
-- Placement: the `lore` schema, which the migration runner (`lore`) owns
-- unconditionally on every cluster — so CREATE/GRANT/FK apply through the normal
-- channel with no `must be owner of table` hazard (unlike the `pipeline` schema's
-- ownership history). `feature_iterations.task_id` is a plain UUID, NOT a FK to
-- `pipeline.tasks`, to avoid needing REFERENCES on a possibly-postgres-owned
-- cross-schema table.
--
-- Single-transaction-safe (no CONCURRENTLY / VACUUM / ALTER TYPE) and fully
-- idempotent: safe to re-run. gen_random_uuid() is core PG13+ (already used by
-- 0015). Append-only — never edit this file after it lands on a live DB.

CREATE TABLE IF NOT EXISTS lore.features (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo               TEXT NOT NULL,
  title              TEXT NOT NULL,
  slug               TEXT NOT NULL,
  path               TEXT NOT NULL,            -- "specs/<slug>" — graph join key
  original_prompt    TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'draft',
  current_iteration  INTEGER NOT NULL DEFAULT 0,
  draft_spec_md      TEXT,                      -- working spec.md, uncommitted until finalize
  parent_feature_id  UUID REFERENCES lore.features(id) ON DELETE SET NULL,
  spec_path          TEXT,
  spec_pr_url        TEXT,
  spec_pr_number     INTEGER,
  issue_number       INTEGER,
  issue_url          TEXT,
  created_by         TEXT NOT NULL DEFAULT 'ui',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT features_status_check CHECK (status IN
    ('draft','planning','awaiting-input','spec-ready','pr-open','implemented','split'))
);

CREATE UNIQUE INDEX IF NOT EXISTS features_repo_slug ON lore.features (repo, slug);
CREATE INDEX IF NOT EXISTS features_repo_updated_idx ON lore.features (repo, updated_at DESC);
CREATE INDEX IF NOT EXISTS features_repo_status_idx  ON lore.features (repo, status);
CREATE INDEX IF NOT EXISTS features_parent_idx       ON lore.features (parent_feature_id);

CREATE TABLE IF NOT EXISTS lore.feature_iterations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id    UUID NOT NULL REFERENCES lore.features(id) ON DELETE CASCADE,
  iteration     INTEGER NOT NULL,
  task_id       UUID,                            -- soft ref to pipeline.tasks (NO FK by design)
  status        TEXT NOT NULL DEFAULT 'running', -- running | ready | failed
  user_answers  JSONB,                           -- per-section feedback that seeded this round
  gap_result    JSONB,                           -- the GapResult the planning pod POSTed
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT feature_iterations_unique UNIQUE (feature_id, iteration)
);

CREATE INDEX IF NOT EXISTS feature_iterations_feature_idx
  ON lore.feature_iterations (feature_id, iteration);

GRANT ALL ON lore.features           TO lore;
GRANT ALL ON lore.feature_iterations TO lore;

-- The web-ui reads features directly (read-only) and routes writes through the
-- mcp API; split-draft inserts may be direct. Grant where the role exists only,
-- so this migration never fails on a cluster that connects the web-ui as `lore`.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lore_ui') THEN
    GRANT SELECT, INSERT, UPDATE ON lore.features           TO lore_ui;
    GRANT SELECT, INSERT, UPDATE ON lore.feature_iterations TO lore_ui;
  END IF;
END $$;

-- Seed org-default agent definitions for the two new claude-code task types
-- (mirrors the 0015 seed; prompt inherits the task-types.yaml base).
INSERT INTO lore.agent_definitions (name, model, timeout_minutes, execution_mode, review_required)
VALUES
  ('feature-planning', 'claude-sonnet-4-6', 15, 'claude-code', false),
  ('feature-finalize', 'claude-sonnet-4-6', 15, 'claude-code', false)
ON CONFLICT (name) WHERE project_id IS NULL DO NOTHING;
