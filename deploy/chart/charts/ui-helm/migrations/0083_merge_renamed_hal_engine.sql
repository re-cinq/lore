-- A renamed repository keeps one lore.repos row, under its new name (#2040,
-- 2026-09-14).
--
-- re-cinq/HAL-engine was renamed to re-cinq/HALEngine on GitHub. Onboarding
-- upserts on full_name, so the new name got a second row while the old one
-- stayed behind. GitHub REST reads redirect the old name, but an App
-- installation token scoped to it cannot be minted, so every run Lore started
-- for the stale row failed to launch. From now on a `repository.renamed`
-- webhook renames the row in place (or merges it, as here); this folds the
-- pair that already exists. The old row's per-repo agent definitions move to
-- the new row unless it already has one of that name; the rest cascade with
-- the old row. The new row inherits the old row's settings only when it has
-- none of its own, which is the case here (the old row carried the cross-repo
-- link to re-cinq/the-expert-ui), and every cross_repo_repos list naming the
-- old repo is pointed at the new one, since those links are stored on both
-- sides. A no-op when either row is absent, so re-running is free.

DO $$
DECLARE
  stale_id UUID;
  current_id UUID;
BEGIN
  SELECT id INTO stale_id FROM lore.repos WHERE full_name = 're-cinq/HAL-engine';
  SELECT id INTO current_id FROM lore.repos WHERE full_name = 're-cinq/HALEngine';

  IF stale_id IS NULL OR current_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE lore.agent_definitions moved
     SET project_id = current_id
   WHERE moved.project_id = stale_id
     AND NOT EXISTS (SELECT 1 FROM lore.agent_definitions kept
                      WHERE kept.project_id = current_id
                        AND kept.name = moved.name);

  UPDATE lore.repos target
     SET settings = source.settings
    FROM lore.repos source
   WHERE source.id = stale_id AND target.id = current_id
     AND (target.settings IS NULL OR target.settings = '{}'::jsonb);

  DELETE FROM lore.repos WHERE id = stale_id;

  UPDATE lore.repos
     SET settings = jsonb_set(settings, '{cross_repo_repos}',
           (SELECT jsonb_agg(DISTINCT CASE WHEN link = to_jsonb('re-cinq/HAL-engine'::text)
                                           THEN to_jsonb('re-cinq/HALEngine'::text) ELSE link END)
              FROM jsonb_array_elements(settings->'cross_repo_repos') AS link))
   WHERE settings->'cross_repo_repos' @> jsonb_build_array('re-cinq/HAL-engine'::text);
END$$;
