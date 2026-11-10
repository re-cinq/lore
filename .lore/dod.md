# Definition of Done

> Refresh drifted Lore-owned deterministic content and verify one complete PR/no-op behavior through the active line, including default-branch and gap reporting.

**Strategy: `direct`** — The scaffolding functionality `decideScaffoldCommit` and the active line handlers (`enrolHandle`, `openOnboardPrHandle`) already exist as seams. The test validates the active line directly.

## Done when these pass

- [ ] **Onboarding Active Line** — refreshes drifted Lore-owned deterministic content, creates a branch, and opens a PR with gap reporting.
  `apps/lore-api/src/work/repo/active-line.acceptance.test.ts`
- [ ] **Onboarding Active Line** — skips PR creation (no-op behavior) when Lore-owned files match canonical exactly.
  `apps/lore-api/src/work/repo/active-line.acceptance.test.ts`

## Facets

- [ ] Fix `decideScaffoldCommit` in `libs/shared/src/work/onboard/onboard-scaffold.ts` to update `lore`-owned files when they differ from the canonical content.
- [ ] Adjust `decideScaffoldCommit` in `libs/shared/src/work/onboard/onboard-scaffold.test.ts` to reflect the new update rules.

## Out of scope

- Refactoring the entire scaffolding update mechanism or applying it to repositories dynamically.
