-- 0055_drop_invalid_github_action_row: remove the org row Kubernetes can never
-- accept.
--
-- Migration 0028 seeded `def-github_action` with an UNDERSCORE. Underscores are
-- invalid in an RFC-1123 resource name, so every apply of that row 422'd — and
-- because the catalog sync loop originally treated each per-entry failure as
-- transient, that one row head-of-line blocked the whole event tail on the
-- central cluster for two hours on 2026-09-01 (a `/agents` delete never landed
-- and stale CRs kept re-asserting). PR #1700's render contract now refuses it
-- loudly instead of looping, but the row is still garbage: `github_action` has
-- no entry in scripts/task-types.yaml, no assembly-line node dispatches it, and
-- the valid `def-github-action` CR the seed rendered has always covered the
-- (unused) type. Prod's copy was deleted by hand during the incident; this is
-- what keeps a FRESH install from seeding it again.
--
-- The catalog event is emitted in the same statement, exactly as the app's own
-- writes do, so every registered cluster-agent hears the delete and reaps the
-- CR pair if one somehow exists.

WITH removed AS (
  DELETE FROM lore.agent_definitions
   WHERE name = 'def-github_action'
     AND project_id IS NULL
  RETURNING name, project_id
)
INSERT INTO lore.catalog_events (name, project_id, op)
SELECT name, project_id, 'delete' FROM removed;
