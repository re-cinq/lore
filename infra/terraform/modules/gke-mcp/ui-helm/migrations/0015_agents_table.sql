-- 0015_agents_table: first-class agent definitions (ADR-024, agent-defs-as-data).
--
-- Per-task-type config (model, timeout, prompt, image) was hardcoded in
-- scripts/task-types.yaml and thinly overridable via lore.repos.settings.
-- task_overrides (JSONB). This promotes it to a real table reached only through
-- project.agentDefs: a row with project_id = NULL is the organisation default; a
-- row with a project_id is that repo's override. Resolution merges
-- project -> org -> task-types.yaml (the yaml stays the prompt base + offline
-- fallback, so seeded org rows leave prompt NULL and inherit it).
--
-- Seeds org rows from the task-types.yaml scalars and migrates any existing
-- settings.task_overrides into per-project rows. The JSONB column is left in
-- place but is no longer read.
--
-- The `pipeline`/`lore` schemas are owned by `lore` (the migration runner), so
-- this applies through the normal channel. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS lore.agent_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  model           TEXT,
  timeout_minutes INTEGER,
  prompt          TEXT,
  image           TEXT,
  project_id      UUID REFERENCES lore.repos(id) ON DELETE CASCADE,
  execution_mode  TEXT NOT NULL DEFAULT 'claude-code',
  review_required BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One org default per name; one project override per (name, repo).
CREATE UNIQUE INDEX IF NOT EXISTS agent_definitions_org_name
  ON lore.agent_definitions (name) WHERE project_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agent_definitions_proj_name
  ON lore.agent_definitions (name, project_id) WHERE project_id IS NOT NULL;

GRANT ALL ON lore.agent_definitions TO lore;
-- The web-ui reads agents through the API, not direct SQL, and not every cluster
-- has a separate `lore_ui` role (some connect the web-ui as `lore`). Grant read
-- only where the role exists so this migration never fails on a missing role.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lore_ui') THEN
    GRANT SELECT ON lore.agent_definitions TO lore_ui;
  END IF;
END $$;

-- Seed org defaults from the task-types.yaml scalars (prompt inherits yaml).
INSERT INTO lore.agent_definitions (name, model, timeout_minutes, execution_mode, review_required)
VALUES
  ('general',         'claude-sonnet-4-6',          30, 'claude-code',  true),
  ('runbook',         'claude-haiku-4-5-20251001',  20, 'claude-code',  true),
  ('implementation',  'claude-sonnet-4-6',          90, 'claude-code',  true),
  ('gap-fill',        'claude-haiku-4-5-20251001',  15, 'claude-code',  false),
  ('review',          'claude-haiku-4-5-20251001',  10, 'claude-code',  false),
  ('feature-request', 'claude-haiku-4-5-20251001',  30, 'claude-code',  true),
  ('onboard',         'claude-haiku-4-5-20251001',  15, 'claude-code',  false),
  ('ingest-specs',     NULL,                        10, 'graph-ingest', false),
  ('ingest-adrs',      NULL,                        10, 'graph-ingest', false),
  ('ingest-tests',     NULL,                        20, 'graph-ingest', false)
ON CONFLICT (name) WHERE project_id IS NULL DO NOTHING;

-- Migrate existing per-repo settings.task_overrides into project rows. Defensive
-- against malformed real data: only iterate object-typed task_overrides + object
-- per-type values, and guard the int/bool casts (a bad value would abort the txn).
INSERT INTO lore.agent_definitions
  (name, model, timeout_minutes, prompt, image, execution_mode, review_required, project_id)
SELECT
  ov.key,
  ov.value->>'model',
  CASE WHEN ov.value->>'timeout_minutes' ~ '^[0-9]+$' THEN (ov.value->>'timeout_minutes')::int END,
  ov.value->>'prompt_template',
  ov.value#>>'{execution,image}',
  'claude-code',
  COALESCE((ov.value->>'review_required') = 'true', false),
  r.id
FROM lore.repos r,
     jsonb_each(
       CASE WHEN jsonb_typeof(r.settings->'task_overrides') = 'object'
            THEN r.settings->'task_overrides' ELSE '{}'::jsonb END
     ) AS ov
WHERE jsonb_typeof(ov.value) = 'object'
ON CONFLICT (name, project_id) WHERE project_id IS NOT NULL DO NOTHING;
