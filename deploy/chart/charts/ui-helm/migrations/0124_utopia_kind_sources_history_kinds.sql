-- 0124_utopia_kind_sources_history_kinds: issues, pull requests and releases get a source each
-- (specs/utopia-graph-mirror FR18.17).
--
-- They shared the `github` source with tags until each became a section of the Utopia Library of
-- its own. A repo's `github` row stays until its source is deleted in Utopia; nothing is pushed
-- to it any more.
--
-- Idempotent: the constraint is dropped if it exists and added again. Runs as `lore`, the owner
-- of the lore schema.

ALTER TABLE lore.utopia_kind_sources DROP CONSTRAINT IF EXISTS utopia_kind_sources_kind_check;

ALTER TABLE lore.utopia_kind_sources ADD CONSTRAINT utopia_kind_sources_kind_check
  CHECK (kind IN ('docs', 'test-coverage', 'git-history', 'github', 'issues', 'pull-requests', 'releases'));
