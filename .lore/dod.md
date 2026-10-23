# Definition of Done

> Update runbooks/dark-factory-rollback.md

**Strategy: `mechanical`** — a fully-specified doc correction to a runbook that has been retired to the graveyard (it implements FR6.39 by adding the station-run-id label).

## Done when these pass

- [x] **No tests needed** — this is a pure documentation correction in a graveyard runbook, which owes no new test and is pinned by no existing test.
  `graveyard/runbooks/dark-factory-rollback.md`

## Facets

- [x] Add `lore.re-cinq.com/station-run-id` to the kubectl label list in `graveyard/runbooks/dark-factory-rollback.md`

## Out of scope

- Updating any other retired component or reviving the dark-factory functionality
