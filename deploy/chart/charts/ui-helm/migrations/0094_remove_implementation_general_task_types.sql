-- 0094_remove_implementation_general_task_types: the `implementation` and
-- `general` task types are gone (#2328, #2329).
--
-- The implementation loop replaced both: code is implemented from a ticket in
-- the repository's backlog, a plan's spec-tasks run on the loop, and task
-- creation refuses a task with no type or with either of these. Their shipped
-- defaults (`implementation.md`, `implementation-tdd.md`, `general.md`) were
-- deleted with the assembly lines that used them, and the boot seed only fills
-- rows from files that exist, so nothing removes the rows it wrote earlier.
-- This does, for the org rows and any per-repo override, and tells every
-- cluster-agent to drop the recipes it rendered from them.

WITH removed AS (
  DELETE FROM lore.agent_definitions
   WHERE name IN ('implementation', 'implementation-tdd', 'general')
  RETURNING name, project_id
)
INSERT INTO lore.catalog_events (name, project_id, op)
SELECT name, project_id, 'delete' FROM removed;

-- Per-repo settings that only these task types read.
UPDATE lore.repos
   SET settings = (settings #- '{task_overrides,implementation}') #- '{task_overrides,general}'
 WHERE settings->'task_overrides' ?| ARRAY['implementation', 'general'];

-- A default dispatch type naming either one already means the loop's backlog
-- (issueDispatchTarget); dropping it leaves the setting saying so.
UPDATE lore.repos
   SET settings = settings - 'dispatch_default_type'
 WHERE settings->>'dispatch_default_type' IN ('implementation', 'general');
