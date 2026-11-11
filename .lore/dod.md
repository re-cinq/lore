# Definition of Done

> Remove the legacy chunked webhook fallback in lore-code-trace/main.go since the API route is now fully deployed.

**Strategy: `direct`** — a seam already exists: `run()` can be executed with a 404 API URL, allowing the test to verify that the code fails outright without attempting the retired fallback logic. The red bar is CI's to show; the `pr-checks` workflow runs the tests.

## Done when these pass

- [ ] **TestDeltaFlowFailsOutrightWhenTheAPIIsAbsent** — asserts that `run()` returns an error and does not POST to the webhook when the API route is absent.
  `apps/lore-code-trace/fallback_acceptance_test.go`

## Facets

- [x] Remove `errIngestRouteAbsent` and its use in `postIngestDelta`.
- [x] Remove the fallback logic in `main.go` that posts to `/api/webhook/ci-tests`.

## Out of scope

- Removing `fetchIngestState`'s treatment of 404 as "no state".
