-- 0021_agent_recipe_fields.sql
--
-- Promote lore.agent_definitions from a thin stub (model/timeout/prompt) to a
-- declarative recipe (ADR-030): the headless tool-access surface, declared
-- run-time resources, an output-sink contract, and a raw tool_config passthrough.
-- `api_version` carries the resource-envelope (apiVersion/kind/spec) schema
-- version. The `image` column is intentionally left untouched — image + compute
-- move to the Station in a later effort.
--
-- Additive and idempotent: every ADD COLUMN is IF NOT EXISTS; the data backfill
-- only fills NULLs. Single-transaction, append-only, runs as role lore.

ALTER TABLE lore.agent_definitions
  ADD COLUMN IF NOT EXISTS description          TEXT,
  ADD COLUMN IF NOT EXISTS api_version          TEXT DEFAULT 'lore.re-cinq.com/v1',
  ADD COLUMN IF NOT EXISTS append_system_prompt TEXT,
  ADD COLUMN IF NOT EXISTS allowed_tools        JSONB,
  ADD COLUMN IF NOT EXISTS disallowed_tools     JSONB,
  ADD COLUMN IF NOT EXISTS permission_mode      TEXT,
  ADD COLUMN IF NOT EXISTS max_turns            INTEGER,
  ADD COLUMN IF NOT EXISTS resources            JSONB,
  ADD COLUMN IF NOT EXISTS output               JSONB,
  ADD COLUMN IF NOT EXISTS tool_config          JSONB;

-- Don't strand existing per-repo config: the legacy
-- settings.task_overrides.<type>.system_prompt_suffix becomes the project row's
-- append_system_prompt (the recipe field that replaces it). Only fills NULLs so a
-- later UI edit is never clobbered, and a re-run is a no-op.
UPDATE lore.agent_definitions a
   SET append_system_prompt = ov.value->>'system_prompt_suffix'
  FROM lore.repos r,
       LATERAL jsonb_each(COALESCE(r.settings->'task_overrides', '{}'::jsonb)) AS ov(key, value)
 WHERE a.project_id = r.id
   AND a.name = ov.key
   AND a.append_system_prompt IS NULL
   AND COALESCE(ov.value->>'system_prompt_suffix', '') <> '';
