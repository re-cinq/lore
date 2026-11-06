-- The shipped default each org-default row was last seeded with
-- (specs/lore-agents FR27). lore-api's boot seeder compares a row against it
-- to tell a field nobody touched (follows the new default) from one somebody
-- edited (kept). NULL = never seeded by the boot seeder: that first contact
-- fills only NULL fields. Project rows never carry it.
ALTER TABLE lore.agent_definitions
  ADD COLUMN IF NOT EXISTS shipped_default JSONB;
