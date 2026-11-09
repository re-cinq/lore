# Definition of Done

> Pending-check handling is not proven: computeStatus accepts null conclusions as passing and ignores status; its 'pending' test actually supplies action_required, while GitHub in-progress checks commonly have null conclusions.

**Strategy: `direct`** — The seam already exists in `computeStatus` which processes checks. We can pass real `status: "in_progress"` or `status: "queued"` with a `null` conclusion to prove it wrongly treats them as passing.

## Done when these pass

- [ ] **leaves a PR open when approved but a check is pending (in_progress with null conclusion)** — fails because it returns "approved" instead of "open"
  `apps/web-ui/src/lib/github.acceptance.test.ts`
- [ ] **leaves a PR open when approved but a check is queued with null conclusion** — fails because it returns "approved" instead of "open"
  `apps/web-ui/src/lib/github.acceptance.test.ts`

## Facets

- [ ] Check `status` explicitly in `isApprovedAndPassing` (or within `computeStatus`), updating its signature if needed to include `status`.
- [ ] Update `isApprovedAndPassing` to treat `conclusion: null` as open when the `status` is `queued` or `in_progress`.

## Out of scope

- Updating any other check processing logic.
- Rewriting the production fetching functions `fetchChecks` / `getPRDetails` (they already supply `status` correctly to `PRDetails`).
