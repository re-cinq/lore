-- 0096_remove_dark_factory_settings: the per-repo `dark_factory` settings block
-- and `task_overrides` were read only by Lore's own Floor, which is deleted
-- (epic #2342). The route, the web tab and the resolver that served them are
-- gone, so a block left in `lore.repos.settings` would be data nothing reads
-- and nothing can edit.
--
-- The baseline table held the pre-feature counter snapshot for the same
-- feature; the capture that wrote it is deleted too.

UPDATE lore.repos
   SET settings = settings - 'dark_factory' - 'task_overrides'
 WHERE settings ?| array['dark_factory', 'task_overrides'];

DROP TABLE IF EXISTS pipeline.dark_factory_baseline;
