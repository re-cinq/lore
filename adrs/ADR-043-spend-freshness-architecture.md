---
adr_number: 43
title: "Spend freshness: daily sync + llm_calls, not per-request API reads"
status: shipped
date: 2026-08-10
deciders: []
domains: [floor, web-ui, cost, architecture]
---

# ADR-043: Spend freshness — daily sync + llm_calls, not per-request API reads

Anthropic's Usage & Cost Admin API only changes once per day, so `/spend`'s
billed figures come from a once-daily database sync rather than per-page-load
API reads, and everything current-day comes from Lore's own
verified-token-exact `pipeline.llm_calls`.

## Context

`/spend` shows two families of figures: Anthropic's authoritative billed cost
(`pipeline.anthropic_cost_daily`, from the Admin Usage & Cost API) and Lore's
own computed cost (`pipeline.llm_calls`, written per LLM call). The billed
figures were originally synced once a day at 07:00 UTC, so the page could
trail reality by up to 24 hours, and PR #1128 added a per-page-load live read:
a Floor route proxying the Admin API on demand (the `sk-ant-admin` key stays
in `lore-floor`), with a TypeScript re-implementation of the page's SQL
rollups so the live path and the DB fallback rendered the same shapes.

Investigating why the live read changed nothing on the page established the
Admin API's actual granularity, each point verified against the live API or
its reference docs during #1136:

- `cost_report` supports **only `1d` buckets**. Sub-daily billed dollars do
  not exist upstream, under any request shape.
- The **in-progress bucket is not emitted**: an hourly usage query returns
  only closed hours, and every correctly-bounded daily query ends at
  yesterday. A day's billed figures appear only after the day closes at UTC
  midnight.
- `ending_at` is **strictly-before** ("time buckets that end before this
  timestamp"); a bucket's end timestamp is exclusive, so an `ending_at` of
  tomorrow-midnight excludes today by construction. The sync therefore sends
  `starting_at` only, sized to exactly 31 candidate buckets (the documented
  `1d` maximum) so the limit can never truncate.
- `cost_report.amount` is **cents** ("lowest currency units… `"123.45"` in
  `"USD"` represents `$1.23`").
- `pipeline.llm_calls` was verified **token-exact** against Anthropic's hourly
  usage report (input 68,459 / output 57,110 from both sources on
  2026-08-10), and its computed cost matches the billed total on closed days.

The consequence: the billed data changes **once per day**. A per-page-load
read fetches byte-identical data on every request except the first after UTC
midnight, while carrying real costs — a second implementation of the rollup
arithmetic that must be kept in parity with the SQL, an extra Floor route on
the admin-key path, and a "live" label that overstated freshness over
day-old data.

## Decision

1. **The daily `anthropic_cost_sync` cron (`0 7 * * *`) is the only
   Anthropic caller.** The cost report changes once a day, so a single sync
   after the day settles is sufficient. The per-page live read, its Floor
   route (`GET /api/anthropic-cost/live`), and the web-ui mirror rollups
   (`aggregateMonthToDate` and friends) are removed. ([validated by `anthropic-cost-sync.test.ts:31`](apps/stations/src/stations/anthropic-cost-sync/anthropic-cost-sync.test.ts#L31), [`anthropic-cost-sync.test.ts:37`](apps/stations/src/stations/anthropic-cost-sync/anthropic-cost-sync.test.ts#L37), [`anthropic-cost-sync.test.ts:43`](apps/stations/src/stations/anthropic-cost-sync/anthropic-cost-sync.test.ts#L43))
2. **`/spend` reads the database only.** Billed figures come from
   `pipeline.anthropic_cost_daily`; everything current-day comes from
   `pipeline.llm_calls`, which is the only source that can cover today at
   all — and the only one with kind attribution (Anthropic reports by model
   only). ([validated by `SpendView.test.tsx:270`](apps/web-ui/src/app/spend/SpendView.test.tsx#L340), [`SpendView.test.tsx:364`](apps/web-ui/src/app/spend/SpendView.test.tsx#L364))
3. **Everything Anthropic has not billed yet is shown as a labeled computed
   line on the billed card** ("billed through 8/18 — + $47.74 over 2 days
   since (Lore-computed)"), never silently summed into the authoritative
   figure. The span is READ from `MAX(bucket_date)`, not assumed to be one
   day: the consequence below makes a cron outage surface as staleness, and
   a line hardcoded to "yesterday — + today" reported a one-day gap through
   an outage of any length, quietly stranding whole days of spend between
   the two figures. ([validated by `SpendView.test.tsx:329`](apps/web-ui/src/app/spend/SpendView.test.tsx#L399), [`SpendView.test.tsx:408`](apps/web-ui/src/app/spend/SpendView.test.tsx#L408), [`SpendView.test.tsx:414`](apps/web-ui/src/app/spend/SpendView.test.tsx#L414))

## Consequences

- One read path and one source of truth per figure; the TS/SQL parity mirror
  and its drift-guard burden are gone.
- Yesterday's billed spend appears at 07:00 UTC. Between UTC midnight and
  07:00 it is in neither the billed rows nor the today-line — an accepted
  trade-off for not running ~23 no-op syncs a day; today's spend is live to
  the second via `llm_calls` throughout.
- The admin key is exercised by the cron only — no request path touches it.
- A cron outage now surfaces as staleness rather than being masked by an
  on-demand fallback; that is deliberate (job_runs tracks failures). At a
  daily cadence a single missed run costs a day of freshness until the next
  tick or a manual `kubectl create job --from=cronjob/...`.
- If Anthropic ever publishes sub-daily or in-progress cost data, the sync
  window (`reportWindow`) is the single place to pick it up.

## Alternatives considered

- **Keep the live route with a long TTL** as a self-healing fallback:
  rejected — it preserves the parity mirror and dual read paths to cover a
  failure mode the hourly cron already covers more simply.
- **Poll the usage report every minute and price tokens ourselves** (the
  standard third-party pattern): rejected — `llm_calls` already records every
  call in real time and is verified token-exact, so upstream polling adds
  latency and bucket-limit handling for strictly less information.
- **Query today's tokens hourly from the usage report**: rejected as
  redundant with `llm_calls` for the same reason; revisit only if `llm_calls`
  coverage ever drifts (a daily closed-days reconciliation of computed vs
  billed would expose that).

## Amendment (2026-08-11): why the cadence stayed daily

The decision as first merged set the cron hourly (`15 * * * *`). Two things
followed. First, the schedule change never reached the cluster: the Helm
release's stored values carry a legacy `lore-floor` block that shadows chart
`values.yaml` edits under `--reset-then-reuse-values`, and the CI deploy
overlay re-asserts only `.resources` — the same class as the 2026-08-03
memory-limit incident. The cluster kept running `0 7 * * *` while the chart
said otherwise. Second, on review the operator preferred the daily cadence:
the data changes once a day, and one settled sync at 07:00 UTC was judged
worth more than 23 no-op runs buying a few hours of day-boundary freshness.
The chart was reverted to `0 7 * * *`, making code match the running cluster;
the midnight–07:00 gap for yesterday's figures is accepted and documented on
the schedule entry. The overlay's cronJobs blind spot is tracked on
issue #1120 (mechanism 3, "Helm stored-values shadowing") — any future
`cronJobs` edit will silently no-op until the overlay covers it.

## Amendment (2026-09-03): real GCP spend joins the page, same shape

### Background

The Kubernetes figure on `/spend` was only ever an estimate (pod-hours ×
assumed profile × env rates), footnoted with "Google's invoice lags a day and
is the truth". The invoice itself is now on the page, and it follows this
ADR's architecture exactly rather than adding a third pattern.

Google publishes actual spend through exactly one machine-readable channel —
the **Cloud Billing export to BigQuery**. There is no API that returns spend
(the Billing API serves SKU price lists), and enabling the export is a
console-only, Billing-Admin-only, one-time step that only accumulates
forward. Terraform (`enable_gcp_billing_export`) provisions the dataset, the
read identity (Workload Identity, `bigquery.jobUser` + dataset-scoped
`dataViewer`) and the env; a person flips the export on once. GKE **cost
allocation** (`cost_management_config`) is enabled on the cluster so the
export itemizes the cluster's line per namespace — free, and it enriches the
same export the sync reads.

### The GCP billed contract

- The **`gcp-cost-sync` station** (sibling of `anthropic-cost-sync`, daily at
  08:00 UTC) reads whichever export table the configured dataset holds,
  preferring the standard `gcp_billing_export_v1_*` table over the detailed
  resource-level one and reporting a dataset with neither as not-yet-enabled. ([validated by [`gcp-billing.test.ts:9`](apps/stations/src/stations/gcp-cost-sync/gcp-billing.test.ts#L9), [`gcp-billing.test.ts:18`](apps/stations/src/stations/gcp-cost-sync/gcp-billing.test.ts#L18), [`gcp-billing.test.ts:27`](apps/stations/src/stations/gcp-cost-sync/gcp-billing.test.ts#L27), [`gcp-billing.test.ts:33`](apps/stations/src/stations/gcp-cost-sync/gcp-billing.test.ts#L33))
- Its rollup query reads the fully qualified export table windowed on
  `usage_start_time`, filtered to the platform's own project (the export
  spans the whole billing account), grouped per UTC day and service with
  credits summed apart from cost. ([validated by [`gcp-billing.test.ts:48`](apps/stations/src/stations/gcp-cost-sync/gcp-billing.test.ts#L48), [`gcp-billing.test.ts:57`](apps/stations/src/stations/gcp-cost-sync/gcp-billing.test.ts#L57), [`gcp-billing.test.ts:61`](apps/stations/src/stations/gcp-cost-sync/gcp-billing.test.ts#L61))
- BigQuery's stringly f/v response cells parse positionally into day/service
  rows, an empty window parses to no rows, and an incomplete query job throws
  rather than storing a partial day. ([validated by [`gcp-billing.test.ts:69`](apps/stations/src/stations/gcp-cost-sync/gcp-billing.test.ts#L69), [`gcp-billing.test.ts:108`](apps/stations/src/stations/gcp-cost-sync/gcp-billing.test.ts#L108), [`gcp-billing.test.ts:112`](apps/stations/src/stations/gcp-cost-sync/gcp-billing.test.ts#L112))
- The window is the Anthropic sync's: today's UTC midnight minus 30 days, 31
  whole candidate days, aligned so `bucket_date` means the same UTC day
  downstream — and re-pulled daily so Google's late restatements self-heal
  through the upsert. ([validated by [`gcp-cost-sync.test.ts:22`](apps/stations/src/stations/gcp-cost-sync/gcp-cost-sync.test.ts#L22), [`gcp-cost-sync.test.ts:28`](apps/stations/src/stations/gcp-cost-sync/gcp-cost-sync.test.ts#L28))
- The sync skips (never fails) while `LORE_GCP_BILLING_PROJECT` /
  `LORE_GCP_BILLING_DATASET` are unset or half-set — the states only a
  person's terraform apply or console visit can change. ([validated by [`gcp-cost-sync.test.ts:6`](apps/stations/src/stations/gcp-cost-sync/gcp-cost-sync.test.ts#L6), [`gcp-cost-sync.test.ts:12`](apps/stations/src/stations/gcp-cost-sync/gcp-cost-sync.test.ts#L12))
- Rows land in `pipeline.gcp_cost_daily` (migration 0060) through
  `PgGcpCost`, upsert-keyed on `(bucket_date, service)` — a re-synced bucket
  replaces the stored totals, mirrored by the `InMemoryGcpCost` double. ([validated by [`cost.test.ts:104`](libs/shared/src/project/cost/cost.test.ts#L104), [`cost.test.ts:123`](libs/shared/src/project/cost/cost.test.ts#L123), [`cost.test.ts:131`](libs/shared/src/project/cost/cost.test.ts#L131), [`cost.test.ts:141`](libs/shared/src/project/cost/cost.test.ts#L141))
- `/api/analytics/spend-window` grew a `gcp` block under the same rules as
  the Anthropic `billed` block: interval-scoped net-of-credits totals,
  whole-table `as_of`/`billed_through` stamps, `available` decided by the
  stamp (a synced zero is not "never synced"), and `optionalTableRows`
  degradation when the table has not been migrated. ([validated by [`spend-window.test.ts:207`](apps/lore-api/src/api/routes/analytics/spend-window.test.ts#L207), [`spend-window.test.ts:223`](apps/lore-api/src/api/routes/analytics/spend-window.test.ts#L223), [`spend-window.test.ts:236`](apps/lore-api/src/api/routes/analytics/spend-window.test.ts#L236))
- The view renders a "Google Cloud (billed)" card (net total plus the day the
  export has closed through) and by-service/daily tables only when available,
  hiding them entirely until the export has synced; the estimate card stays
  regardless, because the export lags a day or more and the estimate is the
  only figure that covers "now". ([validated by [`SpendView.test.tsx:244`](apps/web-ui/src/app/spend/SpendView.test.tsx#L244), [`SpendView.test.tsx:253`](apps/web-ui/src/app/spend/SpendView.test.tsx#L253), [`SpendView.test.tsx:279`](apps/web-ui/src/app/spend/SpendView.test.tsx#L279))