# Definition of Done

> The review line starts on PRs opened by Lore's own App. Today decideReviewOnOpen (libs/shared/src/work/review/code-review-decisions.ts) skips every PR whose author ends in [bot], re-checks included, so no Lore-authored PR is ever reviewed on its own and lore-reviewer would never be asked to approve. Lore's App is let through; every other bot stays skipped. Lore’s App is recognised by its own login, read once at startup with GET /app under the App’s JWT (the App slug plus the [bot] suffix) and held in memory for the life of the process, so no login is hardcoded and every other bot still fails the plain [bot] suffix check.

**Strategy: `direct`** — A seam already exists (`decideReviewOnOpen` is an exported pure function tested directly). We can pass the in-memory app login as a new parameter to `decideReviewOnOpen`.

## Done when these pass

- [ ] **decideReviewOnOpen lets a PR by Lore's own App through while refusing other bots** — validates that Lore's own App PRs are not skipped while other `[bot]` PRs continue to be skipped.
  `libs/shared/src/work/review/code-review-decisions.test.ts`

## Facets

- [ ] Add `loreAppLogin?: string` to `decideReviewOnOpen` input parameter types.
- [ ] Implement behavior in `decideReviewOnOpen` to return `true` when `pr.author === loreAppLogin`.
- [ ] Update callers of `decideReviewOnOpen` to pass the `loreAppLogin` state.

## Out of scope

- Implementation of the `GET /app` cache mechanism, which is just the source of the `loreAppLogin` passed down to this logic.