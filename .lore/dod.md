# Definition of Done

> The click reaches lore-api's validate route, which runs the planning line's validate station by hand in the plan's own run and answers 202 with that run; it refuses with 409 an approved plan, a plan with no planning line yet, and a line whose agent is still working rather than parked on the author.

**Strategy: `direct`** — The `validate` route can be hit directly through Hapi injection, exactly as other plan lifecycle routes are tested.
The red bar is CI's to show, as the local pod cannot run tests that require a PostgreSQL database. The CI job `test` (or `test-lore-api`) runs these tests.

## Done when these pass

- [ ] **answers 202 with the run when running the validate station over a draft plan** — validates successful `validate` call
  `apps/lore-api/src/integration-tests/plan-validate.acceptance.test.ts`
- [ ] **answers 409 to validating an approved plan** — validates rejection of approved plan
  `apps/lore-api/src/integration-tests/plan-validate.acceptance.test.ts`
- [ ] **answers 409 to validating a plan with no planning line yet** — validates rejection of plan with no line
  `apps/lore-api/src/integration-tests/plan-validate.acceptance.test.ts`
- [ ] **answers 409 to validating a plan whose agent is still working** — validates rejection of plan being refined
  `apps/lore-api/src/integration-tests/plan-validate.acceptance.test.ts`

## Facets

- [x] register the `validate` route in `plan-lifecycle.ts` and ensure it maps to `validateFloorPlan` in `floor-plan-verbs.ts`
- [x] implement `assertValidatable` in `plan-validate.ts` to reject approved plans, missing lines, and working agents

## Out of scope

- UI elements (`Validate the plan` button logic)
- `plan-findings` station processing validation findings
- `plan-validate` recipe writing findings
