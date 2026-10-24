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
- [x] Fix format CI failures: remove comments from test files, reduce 5-expect tests to 1 via toEqual, move sleep declaration closer to first use, fix unnecessary conditional in pollUntil, and add/correct spec links for all four backoff tests.
- [x] Correct stale pollUntil spec link from L92 to L96 (re-lint resolver counts from test body start, not it() declaration).
- [x] Correct stale runPollLoop "false from the start" spec link from L75 to L79 (same resolver rule: body start, not it() declaration).
- [x] Correct stale runPollLoop "Omitting isIdle" spec link from L52 to L55 (re-lint resolver found test at L55, not the it() declaration at L52).
- [x] Fix lint failures: "false from start" link L55→L81 (L55 fell inside first test's range, not the third test), and pollUntil link L96→L98 (L96 was a blank line outside any test's range).

## Out of scope

- Altering the existing `withBackoff` implementation or tests.
