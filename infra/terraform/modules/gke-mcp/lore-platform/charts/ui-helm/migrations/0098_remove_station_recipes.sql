-- 0098_remove_station_recipes: the `def-*` rows were the recipes of the node
-- stations the old walk dispatched as pods (validate, detect, ingest, issues,
-- retrospective, gate). Those stations and the `lore-station` image that ran
-- them are deleted, and so are their shipped defaults (`def-*.md`).
--
-- The boot seed only fills rows from files that exist, so nothing removes the
-- rows it wrote earlier. This does, for the org rows and any per-repo override,
-- and tells every cluster-agent to drop the recipes it rendered from them.

WITH removed AS (
  DELETE FROM lore.agent_definitions
   WHERE name LIKE 'def-%'
  RETURNING name, project_id
)
INSERT INTO lore.catalog_events (name, project_id, op)
SELECT name, project_id, 'delete' FROM removed;
