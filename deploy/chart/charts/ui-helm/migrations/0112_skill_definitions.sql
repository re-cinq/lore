-- 0112_skill_definitions: org-managed dynamic skills persisted in lore.skill_definitions (specs/org-skills FR-001).
-- project_id is reserved for future per-repo overrides; all v1 rows use NULL for org-wide scope.

CREATE TABLE IF NOT EXISTS lore.skill_definitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  title       TEXT,
  description TEXT,
  model       TEXT,
  content     TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  project_id  UUID REFERENCES lore.repos(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS skill_definitions_org_name
  ON lore.skill_definitions (name) WHERE project_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS skill_definitions_proj_name
  ON lore.skill_definitions (name, project_id) WHERE project_id IS NOT NULL;

GRANT ALL ON lore.skill_definitions TO lore;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'GRANT SELECT ON lore.skill_definitions TO lore_ui';
  END IF;
END$$;
