-- 0016_rename_agents_to_agent_definitions: finish the lore.agents ->
-- lore.agent_definitions rename for databases that already applied the original
-- 0015 (#613/#614), which created the table as lore.agents. 0015 was later
-- edited in place to create the table under the new name, but the migration
-- runner skips an already-applied filename — so existing DBs still hold
-- lore.agents while the app now queries lore.agent_definitions.
--
-- This renames the table and its two partial unique indexes. Grants and the
-- seeded + backfilled rows are preserved by RENAME. Guarded with IF EXISTS so it
-- is a clean no-op on a fresh DB that already built lore.agent_definitions from
-- the updated 0015. Idempotent: safe to re-run.
--
-- The `lore` schema is owned by `lore` (the migration runner), which owns the
-- table, so the ALTERs apply through the normal channel.

ALTER TABLE IF EXISTS lore.agents RENAME TO agent_definitions;
ALTER INDEX IF EXISTS lore.agents_org_name RENAME TO agent_definitions_org_name;
ALTER INDEX IF EXISTS lore.agents_proj_name RENAME TO agent_definitions_proj_name;
