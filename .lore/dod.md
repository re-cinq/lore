# Definition of Done

> The spend page now shows a **Billing Source** split (API key vs subscription) **derived from cluster attribution**: `llm_calls.station_run_id → station_runs.cluster_agent_id` — no cluster = org API key, a named cluster = a satellite on its own subscription (the same `cluster_agent_id IS NULL` rule the balance used). See `apps/web-ui/src/app/spend/SpendBillingSource.tsx`.

**Strategy: `direct`** — The API endpoint can be tested directly to assert it returns the precise `billing_mode` recorded in the database instead of attributing all calls to `api_key`. The red bar is CI's to show; the CI job that runs the tests is `build`.

## Done when these pass

- [ ] **splits by recorded billing_mode directly instead of inferring from cluster** — The `/api/analytics/spend-window` endpoint correctly reads the `billing_mode` from the mock DB and surfaces it to the client, failing if it defaults to `api_key`.
  `apps/lore-api/src/transport/routes/analytics/spend-window-billing.acceptance.test.ts`
- [ ] **stops calling the billing source a proxy** — The note drops the explanation about inferring the credential from agent startup once the precise per-call split is present.
  `apps/web-ui/src/app/spend/SpendBillingSource.acceptance.test.tsx`

## Facets

- [ ] Add `billing_mode` column via migration
- [ ] Record the mode at dispatch inside Floor's Agent CR creation / cost ingestion
- [x] Update `/api/analytics/spend-window` endpoint to read the new mode directly
- [x] Remove proxy wording from `SpendBillingSourceNote`
- [x] Fix format/lint errors: remove test comments, fix max-lines-per-function, add spec link for acceptance tests

## Out of scope

- Extracting the exact credential from the ai-agent-subsystem directly (the dispatch-time stamp is a sufficient proxy).