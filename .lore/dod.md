# Definition of Done

> Onboarding merge stamps last_ingested_at without ingesting; the lore-api sweep that did ingest is dead

**Strategy: `direct`** — The `PgSettings` adapter is already tested in `settings-pg.test.ts` using a `fakePool` that captures every SQL statement. `markOnboardingMergedById` can be called through that seam and the captured SQL inspected to confirm `last_ingested_at` is absent.

## Done when these pass

- [ ] **markOnboardingMergedById does not stamp last_ingested_at** — The SQL issued by `markOnboardingMergedById` sets `onboarding_pr_merged = true` but does not include `last_ingested_at = now()`. This pins option 2: CI owns ingestion, the merge check is not an ingest, and the staleness warning must not be silenced by a write that did nothing.
  `libs/shared/src/outbound/project/settings/settings-pg.test.ts`

## Facets

- [ ] Drop `last_ingested_at = now()` from the `markOnboardingMergedById` SQL in `settings-pg.ts:172` (the live path that stamps without ingesting).
- [ ] Delete `checkOnboardingPRs`, `checkOnboardingPr`, and `recordMergedOnboarding` from `apps/lore-api/src/work/repo/repo-onboard.ts` (dead code — no callers outside their own definitions).
- [ ] Confirm the test above goes green; confirm the 7 existing tests in the same describe block still pass.

## Out of scope

- Wiring a real ingest on onboarding PR merge (option 1 from the ticket): the ticket treats CI-owned ingestion as the correct path and the existing `markIngested` call in the CI webhook is the right stamp.
- The "Initial ingestion" `general` task in `recordMergedOnboarding`: it is part of the dead path being deleted, not a separate feature to preserve.
- The `pendingOnboardingRepos` query: it has no callers in the live path either, but the ticket does not name it, so it is out of scope.
