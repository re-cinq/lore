# Definition of Done

> `pipeline.llm_calls` records every call's tokens/cost regardless, but has **no column** marking which credential paid — its fields are model, input/output tokens, cost, the task/assembly/station/job refs, status, duration.

**Strategy: `direct`** — `billingSourceSplit` is a pure function and `BillingSource` is a directly renderable React component; both are exercisable from tests without any seam to build.

## Done when these pass

- [x] **billingSourceSplit uses billing_mode, not cluster** — classifies rows by their recorded `billing_mode` (`api`/`subscription`) and falls back to cluster attribution only for rows where `billing_mode` is `unknown`
  `apps/web-ui/src/app/spend/SpendBillingSource.billing-mode.test.tsx`

- [x] **BillingSource note drops proxy language** — when rows carry recorded billing modes the note no longer says "Derived from which cluster ran each call"
  `apps/web-ui/src/app/spend/SpendBillingSource.billing-mode.test.tsx`

## Facets

- [x] Add `billing_mode` migration under `ui-helm/migrations/` — nullable column, default `unknown` for historical rows.
- [x] Extend the `by_cluster` row type (or a new `by_billing_mode` field on the API) to carry `billing_mode: 'api' | 'subscription' | 'unknown'`.
- [ ] Set `billing_mode` at dispatch time in the write path (`agent-events-cost.ts` → `usage-pg.ts` or via station-run join).
- [x] Rewrite `billingSourceSplit` to group by `billing_mode` when known, fall back to `cluster === null` rule for `unknown` rows.
- [x] Update `BillingSourceNote` to say the split comes from the recorded mode, not the cluster proxy.

## Out of scope

- Exact per-call credential accuracy from the ai-agent-subsystem (separate repo; a dispatch-time stamp is a good first approximation).
- Migration of historical rows from `unknown` to a real mode (not enough data; cluster fallback covers them).
- The `llm_calls` cost-sink write path is out of scope if `station_runs` join resolves the mode at read time.
