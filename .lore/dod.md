# Definition of Done

> the downstream scaffold skips drifted Lore-owned files.

**Strategy: `direct`** — `commitOnboardScaffold` is exposed directly and uses the `ScaffoldRepo` interface, so we can test the canonical-refresh logic without mocking the whole assembly line.

## Done when these pass

- [ ] **commits a Lore-owned file when the branch's copy differs from the canonical content** — asserts that a drifted LORE-owned file is committed while an identical one is skipped
  `libs/shared/src/work/onboard/onboard-scaffold.acceptance.test.ts`

## Facets

- [x] update `decideScaffoldCommit` to return true when a LORE-owned file differs from canonical content

## Out of scope

- modifying the `lore_onboard_repo` MCP proxy logic
- modifying assembly line structures
