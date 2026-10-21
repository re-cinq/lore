# Definition of Done

> Record the actual billing mode per call so the split is exact rather than inferred

**Strategy: `direct`** — The write path ingestion exposes a direct seam via `ensureStationRun` and `logLlmCall`. We can assert that the generated `llm_calls` row surfaces the provided `billingMode` in the Spend API. The red bar is CI's to show ("Integration Tests" job).

## Done when these pass

- [ ] **records the billing mode at dispatch and joins it into the cost row** — When `ensureStationRun` receives a `billingMode`, `logLlmCall` propagates it to `pipeline.llm_calls` where the `/spend-window` endpoint correctly surfaces it.
  `apps/lore-api/src/integration-tests/billing-mode-write.acceptance.test.ts`

## Facets

- [x] Add `billing_mode` column to `pipeline.llm_calls` (or `pipeline.station_runs`) via `ui-helm/migrations/`.
- [x] Add `billingMode` property to `StationRunStartInput`.
- [x] Propagate `billingMode` in `PgAssemblyRuns.ensureStationRun` to the database.
- [x] Ensure `PgUsage.logLlmCall` records `billing_mode` in `llm_calls` at ingest time.

## Out of scope

- Emitting the credential from the separate `ai-agent-subsystem` repo (the ticket marks this as follow-up work).
