# Definition of Done

> Reconcile obsolete execution/bot clauses while retaining the complete fallback, delivery-failure, recheck and reply behavior; validate the reconciled cases.

**Strategy: `mechanical`** — The ticket is a small, fully-specified edit that owes no new permanent test. The edits update the outdated LoreTask references in the specification to reflect the current external-floor reality, and correct the bot guard clauses.

## Done when these pass

- [ ] **starts nothing when the lore bot comments @lore review** — EXISTING test validating that a bot comment starts nothing.
  `apps/stations/src/events/floor-review-handlers.test.ts`
- [ ] **starts no reply for a review the lore bot submitted** — EXISTING test validating that the bot does not start a reply for its own review.
  `libs/shared/src/work/review/floor-review-start.test.ts`

## Facets

- [x] Replace the obsolete LoreTask architecture diagrams and explanations with the external floor mechanism in `specs/auto-review-loop/spec.md`.
- [x] Clarify that bot-authored PRs are skipped *except* for Lore's own App login, which receives a review in `specs/auto-review-loop/spec.md`.

## Out of scope

- Changing the implementation of `review-start.ts` or modifying the codebase logic, as the ticket clearly indicates the features are already implemented and only the specification text requires reconciliation.