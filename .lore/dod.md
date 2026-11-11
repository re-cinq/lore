# Definition of Done

> Add an existing-registration-path regression proving the ask is inserted through the supplied pool before analyze starts, without shared initPool; retain the fixed wiring.

**Strategy: `direct`** — The `registerPlanning` registration function already exposes a seam for `getPool`, allowing us to prove Refine asks are recorded there rather than through the shared `initPool`.

## Done when these pass

- [x] **A Refine through production dependency construction records its ask on the server pool and starts analyze**
  `apps/lore-api/src/app/register-planning.acceptance.test.ts`
- [x] **A missing pool yields the named configuration refusal**
  `apps/lore-api/src/app/register-planning.acceptance.test.ts`

## Facets

- [x] Prove Refine ask is inserted through the supplied pool without shared initPool
- [x] Retain fixed wiring

## Out of scope

- Refactoring production code (the wiring is already fixed).