# Definition of Done

> Inbox eligibility consumes current station metadata from readLineFacts.
> await-ci is excluded from actionable human waiting items.

**Strategy: `direct`** — readLineFacts is the existing seam that evaluates station kinds; the tests call it directly and fail because the metadata exposure and eligibility behavior are missing.

## Done when these pass

- [ ] **reads the station kind from the station body the line version names**
  `apps/lore-api/src/work/floor/inbox-eligibility.acceptance.test.ts`
- [ ] **excludes await-ci from actionable human waiting items**
  `apps/lore-api/src/work/floor/inbox-eligibility.acceptance.test.ts`

## Facets

- [ ] Expose station metadata in the LineFacts returned by readLineFacts
- [ ] Ensure await-ci and await-pr are not actionable human waiting items in the metadata or predicate

## Out of scope

- UI implementation for the Inbox
- Other sources of Inbox items (plans, onboarding, triage)
