-- 0123_agent_prompt_updates: a prompt migration. Boot seeding never overwrites an agent the floor
-- already holds (#3995), so a changed shipped prompt reaches the floor through a queued row:
-- `SELECT lore.update_prompt('<agent>', '<file>.md');` in a later migration, which lore-api applies
-- at boot by writing that libs/shared/src/agent-defaults file's prompt as the agent's org default,
-- then stamps `applied_at`. A row the floor refuses stays queued for the next boot.
--
-- Idempotent: IF NOT EXISTS and CREATE OR REPLACE. Runs as `lore`, the owner of the lore schema.

CREATE TABLE IF NOT EXISTS lore.agent_prompt_updates (
  id          BIGSERIAL PRIMARY KEY,
  agent       TEXT NOT NULL,
  file        TEXT NOT NULL,
  queued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at  TIMESTAMPTZ
);

GRANT ALL ON lore.agent_prompt_updates TO lore;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'REVOKE ALL ON lore.agent_prompt_updates FROM lore_ui';
  END IF;
END$$;

CREATE OR REPLACE FUNCTION lore.update_prompt(agent TEXT, file TEXT) RETURNS void
  LANGUAGE sql AS $$
    INSERT INTO lore.agent_prompt_updates (agent, file) VALUES ($1, $2)
  $$;
