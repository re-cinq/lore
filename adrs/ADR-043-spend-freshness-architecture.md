---
adr_number: 43
title: "Spend freshness: hourly sync + llm_calls, not per-request API reads"
status: shipped
date: 2026-08-10
deciders: []
domains: [floor, web-ui, cost, architecture]
---

# ADR-043: Spend freshness — hourly sync + llm_calls, not per-request API reads

Anthropic's Usage & Cost Admin API only changes once per day, so `/spend`'s
billed figures are kept fresh by an hourly database sync rather than
per-page-load API reads, and everything current-day comes from Lore's own
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

1. **The hourly `anthropic_cost_sync` cron is the only Anthropic caller**
   (`15 * * * *`). ~23 of 24 runs are no-op upserts; yesterday's bucket lands
   within an hour of the API publishing it, and a failed run self-heals on
   the next tick. The per-page live read, its Floor route
   (`GET /api/anthropic-cost/live`), and the web-ui mirror rollups
   (`aggregateMonthToDate` and friends) are removed. ([validated by `anthropic-cost-sync.test.ts:28`](apps/floor/src/jobs/cost/anthropic-cost-sync/anthropic-cost-sync.test.ts#L28), [`anthropic-cost-sync.test.ts:34`](apps/floor/src/jobs/cost/anthropic-cost-sync/anthropic-cost-sync.test.ts#L34), [`anthropic-cost-sync.test.ts:40`](apps/floor/src/jobs/cost/anthropic-cost-sync/anthropic-cost-sync.test.ts#L40))
2. **`/spend` reads the database only.** Billed figures come from
   `pipeline.anthropic_cost_daily`; everything current-day comes from
   `pipeline.llm_calls`, which is the only source that can cover today at
   all — and the only one with kind attribution (Anthropic reports by model
   only). ([validated by `SpendView.test.tsx:164`](apps/web-ui/src/app/spend/SpendView.test.tsx#L164), [`SpendView.test.tsx:183`](apps/web-ui/src/app/spend/SpendView.test.tsx#L183))
3. **Today is shown as a labeled computed line on the billed card**
   ("billed through yesterday — + $X today (Lore-computed)"), never silently
   summed into the authoritative figure. ([validated by `SpendView.test.tsx:214`](apps/web-ui/src/app/spend/SpendView.test.tsx#L214), [`SpendView.test.tsx:223`](apps/web-ui/src/app/spend/SpendView.test.tsx#L223), [`SpendView.test.tsx:231`](apps/web-ui/src/app/spend/SpendView.test.tsx#L231))

## Consequences

- One read path and one source of truth per figure; the TS/SQL parity mirror
  and its drift-guard burden are gone.
- Billed freshness is within one hour of the best the API can provide;
  today's spend is live to the second via `llm_calls`.
- The admin key is exercised by the cron only — no request path touches it.
- A cron outage now surfaces as staleness rather than being masked by an
  on-demand fallback; that is deliberate (job_runs tracks failures).
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
