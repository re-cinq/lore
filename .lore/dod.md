# Definition of Done

> An initial multi-repository backfill staggers PR creation with an explicit, tested limit.

**Strategy: `direct`** — The `specUpkeepTick` iterates all onboarded repositories natively and we can observe and constrain the total number of pipeline runs it starts in a single invocation directly.

## Done when these pass

- [x] **spec upkeep throttling** — staggers PR creation with an explicit limit across repositories on an initial burst
  `libs/shared/src/work/spec-upkeep/floor-spec-upkeep.acceptance.test.ts`

## Facets

- [x] Enforce a numerical limit on total `startRun` invocations per `specUpkeepTick` run.

## Out of scope

- Adjusting behavior inside individual stations (e.g. `detect-unlinked`) since cross-repo limits must be tracked at the scheduler loop level.