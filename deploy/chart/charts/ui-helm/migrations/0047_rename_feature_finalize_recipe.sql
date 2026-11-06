-- 0047_rename_feature_finalize_recipe: the recipe that WRITES the spec is named
-- for what it writes, not for a lifecycle stage that no longer exists.
--
-- `feature-finalize` named two different things: a task type (retired — the
-- planning line now walks a feature from its first round to its filed issues, so
-- nothing mints a separate finalize task) and the RECIPE the `write` and `push`
-- nodes run. Only the recipe survives, and "finalize" was never true of it: it
-- writes specs/<slug>/spec.md and commits, after which a human still reviews the
-- PR. It pairs with the existing `spec-analysis`, so it is `spec-write`.
--
-- 0017 seeded the org-default row. Migrations are APPEND-ONLY — editing 0017 is
-- inert on a database that already applied it — so the rename happens here.
--
-- Idempotent both ways: skipped once `spec-write` exists (re-run, or a fresh
-- database seeded from the current catalog), and a no-op where the old name was
-- never present. A per-project override of the old name is renamed too; without
-- that, a repo that customised the recipe would silently fall back to the org
-- default and run a prompt nobody chose.
UPDATE lore.agent_definitions AS old
   SET name = 'spec-write'
 WHERE old.name = 'feature-finalize'
   AND NOT EXISTS (
     SELECT 1
       FROM lore.agent_definitions AS existing
      WHERE existing.name = 'spec-write'
        AND existing.project_id IS NOT DISTINCT FROM old.project_id
   );
