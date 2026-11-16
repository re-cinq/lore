# Definition of Done

> Full PR merges close the ticket with Lore-Task traceability; partial PR merges leave it open.

**Strategy: `direct`** — The `loopMergeHandlers` provide a direct seam to simulate a `github.pull_request.closed` event containing a partial-coverage PR body.

## Done when these pass

- [ ] **leaves the issue open when a partial-coverage pull request merges** — The issue must not be closed unconditionally if the PR body contains `Refs #N` instead of `Closes #N`.
  `apps/stations/src/events/loop-merge-handlers.acceptance.test.ts`

## Facets

- [ ] Inspect the pull request body from the event to detect if it's a partial merge.
- [ ] Skip the `closeIssue` call in `settleIssue` when a partial merge is detected.

## Out of scope

- Updating the GitHub event mapping (assuming `body` is added to the event or fetched independently).
