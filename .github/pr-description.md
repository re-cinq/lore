## Why

`pipeline.llm_calls` records every call's tokens and cost but has no column
marking which credential paid. The Billing Source split on the spend page
classified rows by which cluster ran each call — no cluster meant the org's
own API key, a named cluster meant a satellite on its own subscription. This
proxy is wrong when an API key is run from a satellite or a subscription token
is used centrally.

## What Changed

- Added a `billing_mode` column (nullable, default `'unknown'`) to the relevant
  pipeline table via a new migration under `ui-helm/migrations/`, so historical
  rows fall back to cluster attribution while new rows carry the recorded mode.
- Extended the `by_cluster` row type in `SpendBillingSource.tsx` to accept an
  optional `billing_mode: 'api' | 'subscription' | 'unknown'` field.
- Rewrote `billingSourceSplit` to group rows by their recorded `billing_mode`
  when present, falling back to the `cluster === null` heuristic only for rows
  where `billing_mode` is `'unknown'`.
- Updated `BillingSourceNote` to describe the split as coming from the recorded
  dispatch-time mode rather than the cluster proxy.

## Testing

Acceptance tests in `apps/web-ui/src/app/spend/SpendBillingSource.billing-mode.test.tsx`
verify both behaviours:
- `billingSourceSplit` classifies rows by `billing_mode` and falls back to
  cluster only for `'unknown'` rows.
- `BillingSource` no longer renders "Derived from which cluster ran each call"
  when rows carry a recorded billing mode.
Both tests pass.
