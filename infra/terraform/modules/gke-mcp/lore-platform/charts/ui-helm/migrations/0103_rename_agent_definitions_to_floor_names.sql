-- 0103_rename_agent_definitions_to_floor_names: the shipped agent defaults are
-- named after the floor's agent definitions now (#2503), and each one's body is
-- the prompt the floor runs. The boot seeder only fills rows from files that
-- exist, so the rows under the old names would stay behind and every edit made
-- on them (an org default, a per-repo override) would stop applying.
--
-- This moves each row to its new name, org defaults and per-repo overrides
-- alike, shipped_default with it, so the seeder's rule still holds: a field
-- still equal to the default last seeded follows the new file, an edited one
-- stays. Where a row under the new name already exists for the same repo (or
-- the org), the two merge field by field: the old row's value wins wherever it
-- has one, the new row's stays where the old one has none. Then the old row
-- goes. Re-running finds no old names and changes nothing.

CREATE TEMP TABLE agent_definition_renames (old_name TEXT, new_name TEXT)
  ON COMMIT DROP;

INSERT INTO agent_definition_renames VALUES
  ('review', 'code-review'),
  ('address-feedback', 'code-review-refine'),
  ('feature-planning', 'plan-analyze'),
  ('acceptance-dod', 'loop-dod'),
  ('tdd-round', 'loop-tdd-round'),
  ('pr-ready', 'loop-pr-ready'),
  ('fix-ci', 'loop-fix-ci'),
  ('onboard', 'onboard-author');

UPDATE lore.agent_definitions AS target
   SET model           = COALESCE(old.model, target.model),
       timeout_minutes = COALESCE(old.timeout_minutes, target.timeout_minutes),
       prompt          = COALESCE(old.prompt, target.prompt),
       image           = COALESCE(old.image, target.image),
       execution_mode  = old.execution_mode,
       review_required = old.review_required,
       config          = COALESCE(old.config, target.config),
       shipped_default = COALESCE(old.shipped_default, target.shipped_default),
       updated_at      = now()
  FROM lore.agent_definitions AS old
  JOIN agent_definition_renames AS r ON r.old_name = old.name
 WHERE target.name = r.new_name
   AND target.project_id IS NOT DISTINCT FROM old.project_id;

DELETE FROM lore.agent_definitions AS old
 USING agent_definition_renames AS r, lore.agent_definitions AS target
 WHERE old.name = r.old_name
   AND target.name = r.new_name
   AND target.project_id IS NOT DISTINCT FROM old.project_id;

UPDATE lore.agent_definitions AS old
   SET name = r.new_name,
       updated_at = now()
  FROM agent_definition_renames AS r
 WHERE old.name = r.old_name;
