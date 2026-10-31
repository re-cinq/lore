-- 0122_drop_agent_definitions: agent definitions live on the floor (#3995).
-- lore-api reads and writes them there only, and the per-repo overrides this
-- table held were moved onto the floor as variants at boot on 2026-10-31, so
-- nothing reads or writes the table any more. Its indexes and grants go with it.

DROP TABLE IF EXISTS lore.agent_definitions;
