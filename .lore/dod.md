# Definition of Done

> the downstream scaffold skips drifted Lore-owned files.

**Strategy: `direct`** — `commitOnboardScaffold` is exposed directly and uses the `ScaffoldRepo` interface, so we can test the canonical-refresh logic without mocking the whole assembly line.

## Done when these pass

- [x] **commits a Lore-owned file when the branch's copy differs from the canonical content** — asserts that a drifted LORE-owned file is committed while an identical one is skipped
  `libs/shared/src/work/onboard/onboard-scaffold.acceptance.test.ts`

## Facets

- [x] update `decideScaffoldCommit` to return true when a LORE-owned file differs from canonical content
- [x] update `enrol-repo.test.ts` to reflect new lore-owned-refresh contract (old "skip + needs-attention" test replaced)
- [x] fix rotten spec link at `specs/4-ux-repo-onboarding/spec.md` FR-5.4 (repointed to onboard-scaffold.test.ts#L29)
- [x] move misplaced validated-by links in FR-2.3 to the trailing group so spec-links and lint CI checks pass

## Out of scope

- modifying the `lore_onboard_repo` MCP proxy logic
- modifying assembly line structures
