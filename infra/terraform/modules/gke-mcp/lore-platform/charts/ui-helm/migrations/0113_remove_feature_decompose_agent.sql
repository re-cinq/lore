-- 0113_remove_feature_decompose_agent: the `feature-decompose` agent is gone.
--
-- The feature-planning line stopped filing tickets (#2886): the spec-tickets
-- line files them, with its own `spec-tickets-decompose` agent, and the
-- `feature-decompose.md` default was deleted with the planning nodes that used
-- it. The boot seed only fills rows from files that exist, so nothing removes
-- the rows it wrote earlier. This does, for the org row and any per-repo
-- override. No catalog event is recorded: the cluster agents that listened for
-- them are gone.

DELETE FROM lore.agent_definitions
 WHERE name = 'feature-decompose';
