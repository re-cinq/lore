-- 0015_agents_table: first-class agent definitions (per ADR — agents-as-data).
--
-- Per-task-type config (model, timeout, prompt, image) was hardcoded in
-- scripts/task-types.yaml and thinly overridable via lore.repos.settings.
-- task_overrides (JSONB). This promotes it to a real table reached only through
-- project.agents: a row with project_id = NULL is the organisation default; a
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

CREATE TABLE IF NOT EXISTS lore.agents (
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
CREATE UNIQUE INDEX IF NOT EXISTS agents_org_name
  ON lore.agents (name) WHERE project_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agents_proj_name
  ON lore.agents (name, project_id) WHERE project_id IS NOT NULL;

GRANT ALL ON lore.agents TO lore;
GRANT SELECT ON lore.agents TO lore_ui;

-- Seed org defaults from the task-types.yaml scalars (prompt inherits yaml).
INSERT INTO lore.agents (name, model, timeout_minutes, execution_mode, review_required)
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

-- Migrate existing per-repo settings.task_overrides into project rows.
INSERT INTO lore.agents
  (name, model, timeout_minutes, prompt, image, execution_mode, review_required, project_id)
SELECT
  ov.key,
  ov.value->>'model',
  NULLIF(ov.value->>'timeout_minutes', '')::int,
  ov.value->>'prompt_template',
  ov.value#>>'{execution,image}',
  'claude-code',
  COALESCE((ov.value->>'review_required')::boolean, false),
  r.id
FROM lore.repos r,
     jsonb_each(COALESCE(r.settings->'task_overrides', '{}'::jsonb)) AS ov
WHERE r.settings ? 'task_overrides'
ON CONFLICT (name, project_id) WHERE project_id IS NOT NULL DO NOTHING;
