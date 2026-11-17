# Definition of Done

> One sketch makes the Prototype section ready. The section needs a prototype or a sketch, and holds at most one prototype; an empty one reads "needs a prototype or a sketch". A ui-change plan still needs a prototype of at least click-dummy maturity at approval, which a sketch does not satisfy.

**Strategy: `direct`** — The validation behaviour is enforced when a plan is approved, which we test by asserting against the API's HTTP 409 rejection and the listed missing requirements. The red bar is CI's to show; the CI job "Lore test-report" runs the tests on push.

## Done when these pass

- [ ] **an empty prototype section reads 'needs a prototype or a sketch' and blocks approval** — blocks an empty Prototype section from being approved
  `apps/lore-api/src/integration-tests/plan-prototype.acceptance.test.ts`
- [ ] **a ui-change plan still needs a prototype of at least click-dummy maturity at approval, which a sketch does not satisfy** — requires a mature prototype for ui-change plans
  `apps/lore-api/src/integration-tests/plan-prototype.acceptance.test.ts`

## Facets

- [x] `planning-document` correctly rejects empty prototype sections
- [x] `planning-document` correctly rejects sketch-only prototypes for `ui-change` plans

## Out of scope

- Rendering of sketches in the web UI
