# Definition of Done

> libs/shared MUST provide domain and outbound-port logic resolving skill definitions across org defaults and per-project overrides, following the two-layer pattern.

**Strategy: `direct`** — The seam does not exist yet (the new `skillDefs` port), but we can directly instantiate the intended `PgSkillDefs` adapter and invoke its `resolve` method to assert the DB-layer merge logic. The red bar is CI's to show; job `shared` runs `npm test -w @re-cinq/lore-shared`.

## Done when these pass

- [ ] **PgSkillDefs resolution (FR-009)** — merges per-project skill row over org-level skill row
  `libs/shared/src/outbound/project/skill-defs.acceptance.test.ts`

## Facets

- [x] Write `skill-defs-port.ts` port and data types.
- [ ] Write `skill-defs.ts` domain facade for `Project`.
- [x] Write `skill-defs-pg.ts` DB adapter with the 2-layer SQL resolution.
- [ ] Add `skillDefs` getter to `Project` facade in `libs/shared/src/outbound/project/lib/project.ts`.

## Out of scope

- Per-repo skill overrides from the UI (v1 serves org-wide only).
- Multi-file skills (only SKILL.md is managed).
- Modifying binary update flow.
