-- 0113_remove_feature_decompose_agent: the `feature-decompose` agent is gone.
--
-- The feature-planning line stopped filing tickets (#2886): the spec-tickets
-- line files them, with its own `spec-tickets-decompose` agent, and the
-- `feature-decompose.md` default was deleted with the planning nodes that used
-- it. The boot seed only fills rows from files that exist, so nothing removes
-- the rows it wrote earlier. This does, for the org row and any per-repo
-- override, and tells every cluster-agent to drop the recipe it rendered from it.

WITH removed AS (
  DELETE FROM lore.agent_definitions
   WHERE name = 'feature-decompose'
  RETURNING name, project_id
)
INSERT INTO lore.catalog_events (name, project_id, op)
SELECT name, project_id, 'delete' FROM removed;
