# Definition of Done

> Human reconciliation of the contradictory spent-budget outcomes is required before closure; preserve the current gate until that decision.

**Strategy: `mechanical`** — The ticket is a doc correction to fix the spec's contradictory statements regarding spent-budget outcomes. The code already reports `stalled` when soundness gaps outlast the budget, matching L282, but L155 contradicted it. The fix updates L155 to match the code and L282. The behaviour is pinned by existing tests for gap counting and stalling.

## Done when these pass

- [ ] **Stalls after five rounds** — the gate reports stalled when gaps outlast the budget.
  `apps/stations/src/planning/qa-gate/branch-checks.test.ts`
- [ ] **Stalls when gaps do not fall** — the gate reports stalled when the gap count does not decrease.
  `apps/stations/src/planning/qa-gate/station.test.ts`
- [ ] **Sends writer back** — soundness findings send the writer back while budget holds.
  `apps/stations/src/planning/qa-gate/branch-checks.test.ts`

## Facets

- [ ] Update `specs/7-feature-planning/spec.md` L155 to say the run reports stalled rather than opening a PR.

## Out of scope

- Changing the `qa-gate` implementation (the current gate behavior is preserved).