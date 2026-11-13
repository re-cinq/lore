-- 0012_memories_repo: add the repo column to memory.memories.
--
-- Repo-scoped memories (commit "feat: repo-scoped memories — write/list/search
-- by repo, not agent ID") made mcp-server/src/memory.ts write and read a `repo`
-- column on memory.memories — INSERT on write_memory, `WHERE repo = $1` on
-- list_memories / search_memory — but no schema artifact ever added the column.
-- On a deployed DB that left the column missing, so:
--   * write_memory / repo-scoped list+search raised "column repo does not exist"
--     (returned to the agent as error text, so it failed quietly), and
--   * the per-repo agents page (web-ui /repos/:o/:r/agents), whose mem_agents CTE
--     filters `memory.memories WHERE repo = $1`, threw a server-side 500.
-- The global /agents page never references repo, which is why only the per-repo
-- page broke.
--
-- Ownership caveat: the `memory` schema is created by the bootstrap superuser
-- (scripts/infra/setup-memory-schema.sh, `psql -U postgres`), so postgres owns
-- memory.memories and `lore` only holds GRANT ALL — which does NOT include the
-- ownership that ADD COLUMN / CREATE INDEX require. The migration runner is
-- `lore`, so on clusters where lore is not the table owner this cannot apply.
-- It therefore runs inside a subtransaction that catches insufficient_privilege
-- and skips with a NOTICE (mirrors 0011's per-schema privilege handling) rather
-- than failing the deploy. Those clusters converge by re-running the (idempotent)
-- baseline setup-memory-schema.sh as the superuser, which now declares the
-- column. Where lore does own the table, this adds it automatically.
--
-- Idempotent: safe to re-run.

DO $$
BEGIN
  ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS repo TEXT;
  CREATE INDEX IF NOT EXISTS memories_repo_idx
    ON memory.memories (repo)
    WHERE is_deleted = FALSE;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'skip memory.memories.repo (runner is not the table owner); run setup-memory-schema.sh as the superuser to converge';
END$$;
