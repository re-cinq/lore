# Definition of Done

> Existing clusters will break or have duplicate author details without a migration for already seeded agents.

**Strategy: `direct`** — The floor migration harness is a seam that allows testing the new migration script directly against an in-memory floor.

## Done when these pass

- [x] **T002: Migrate existing prompts to use Helm author values** — migrates existing agents with hardcoded author blocks cleanly without prompt duplication
  `apps/lore-api/src/work/floor/migrate-agent-author.acceptance.test.ts`

## Facets

- [x] Add the migration script `0012_migrate_agent_author.ts` to `apps/lore-api/src/work/floor/migrations/`.
- [x] Implement `migrate` to read existing prompts, strip the hardcoded git config lines, and save.

## Out of scope

- Setting up Helm configurations or author Helm charts (already handled in T001).