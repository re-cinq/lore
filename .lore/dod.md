# Definition of Done

> Implement the functions defined in the spec for backoff.ts.

**Strategy: `direct`** — The entry points `backoffDelay`, `runPollLoop`, and `pollUntil` are new exports meant to be added directly to the existing `backoff.ts` module.

## Done when these pass

- [ ] **returns baseMs * 2^attempts capped at maxMs, flooring a negative attempt count at the base delay** — pins backoffDelay output calculations
  `libs/shared/src/lib/backoff.acceptance.test.ts`
- [ ] **ticks while running() holds, awaits onOutcome before the sleep that follows it...** — pins runPollLoop's polling and progressive delay intervals
  `libs/shared/src/lib/backoff.acceptance.test.ts`
- [ ] **returns the first non-null value tick yields without sleeping...** — pins pollUntil's wait and retry behaviour
  `libs/shared/src/lib/backoff.acceptance.test.ts`

## Facets

- [x] Implement `backoffDelay` with exponential increase and boundary checks.
- [x] Implement `runPollLoop` to correctly handle `idleTicks` and sleep duration.
- [x] Implement `pollUntil` to combine polling logic with backoff delays.

## Out of scope

- Altering the existing `withBackoff` implementation or tests.
