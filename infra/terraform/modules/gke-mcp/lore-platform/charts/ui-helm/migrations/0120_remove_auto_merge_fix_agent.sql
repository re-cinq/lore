-- 0120_remove_auto_merge_fix_agent: the auto-merge line fixes nothing any more
-- (specs/protected-branch-merge), so its `auto-merge-fix` agent is gone, and so
-- is its shipped default (`auto-merge-fix.md`).
--
-- The boot seed only fills rows from files that exist, so nothing removes the
-- row it wrote earlier. This does, for the org row and any per-repo override,
-- and tells every cluster-agent to drop the recipe it rendered from them.

WITH removed AS (
  DELETE FROM lore.agent_definitions
   WHERE name = 'auto-merge-fix'
  RETURNING name, project_id
)
INSERT INTO lore.catalog_events (name, project_id, op)
SELECT name, project_id, 'delete' FROM removed;
