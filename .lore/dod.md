# Definition of Done

> Current waits ignore the loop's own check, but pinned active stations/shared work contain no publisher for lore/implementation-loop or pr_check_sha. The active loop station registry has only opener, mark-ready, sync, description and done checks; exclusion is not publication.

**Strategy: `direct`** — an active loop station publisher is missing; testing through `buildStationHandlers()` provides a seam to verify if the missing events (`station_run.dispatched`, `run.settled`) have handlers that publish progress.

## Done when these pass

- [x] **refreshes the check as the run enters each step** — fails because no handler exists for `station_run.dispatched`
  `apps/stations/src/events/loop-progress.acceptance.test.ts`
- [x] **publishes a green check when a finished run completed** — fails because no handler exists for `run.settled`
  `apps/stations/src/events/loop-progress.acceptance.test.ts`
- [x] **closes the check left on the previous head as neutral Superseded when the head moves** — fails because no handler exists for `station_run.dispatched`
  `apps/stations/src/events/loop-progress.acceptance.test.ts`

## Facets

- [x] Write a `loop-progress-handlers.ts` module with handlers for `station_run.dispatched` and `run.settled`
- [x] Wire the handlers into `buildStationHandlers()`
- [x] Publish the `lore/implementation-loop` GitHub check appropriately on each event

## Out of scope

- Testing or modifying `loop-upkeep-handlers` directly since it handles `github.push` and `github.check_suite`.
