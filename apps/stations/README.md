# Lore Stations (`@re-cinq/lore-stations`)

The **stations service** — every Station in the factory, one folder each, behind
one shared registry. A station is a self-contained unit of work; this service
runs the ones that live next to the data instead of tunnelling their reads and
writes through the Floor. The design split is deliberate: **the Floor still owns
WHEN a station runs** (its cron tick handlers call `POST /api/stations/{name}`
over HTTP via the shared `StationClient`); **this service owns WHAT the work
does**. See [ADR-024](../../adrs/ADR-024-ubiquitous-language-execution-model.md)
(the service-station amendment) and
[ADR-044](../../adrs/ADR-044-event-router-owns-the-event-bus.md), which sent the
first two — `merge-check` and `approval-check` — here verbatim.

## One registry, four execution forms

`src/stations/registry.ts` is the single `Record<StationName, StationModule>` —
a name with no module is a **compile error**, replacing three hand-kept maps
that could not check each other. Each station's `manifest.ts` declares its
triggers, and every surface below is **derived** from the manifests, so the URL
map and the drain subscriptions can never drift:

- **Sweeps** (`http` + `cron` triggers) — served at `POST /api/stations/{name}`
  (synchronous; returns `{ summary }`; 404 unknown name, 409 already running via
  an in-process latch, hence `replicaCount: 1`).
- **Event sweeps** (`event` triggers) — the **drain loop** claims the event from
  `pipeline.event_deliveries` as subscriber `stations` (ADR-044 amendment) and
  runs the sweep that declared it.

Lore's stations for the external floor are not in this registry: they live one
folder each under `src/code-review/`, `src/planning/`, `src/merge/`,
`src/onboard/`, `src/implementation-loop/`, `src/spec-upkeep/` and `src/digest/`,
written with `@re-cinq/floor-station`.

| Station | Form | Trigger / runtime |
| --- | --- | --- |
| `merge-check` | sweep | cron `*/1 * * * *` + http |
| `pr-ready-check` | sweep | cron + http |
| `loop-tick`, `spec-upkeep-tick`, `digest-tick` | sweep | cron (start runs on the external floor) |
| `bus-prune`, `telemetry-prune` | sweep | cron |
| `memory-ttl` | sweep | cron hourly (courier CronJob) + http |
| `importance-decay` | sweep | cron 05:00 (courier CronJob) + http |
| `consolidation` | sweep | cron 05:30 (courier CronJob) + http |
| `anthropic-cost-sync`, `gcp-cost-sync` | sweep | cron (courier CronJob) + http |

The node stations the old walk dispatched (`detect`, `ingest`, `validate`,
`retrospective`, `feature-review`, `pr-review`, `ci-check`), the
`approval-check` sweep and the `lore-station` pod image that ran one node per
pod were deleted on 2026-10-02 with the engine that started them.

## Boundaries

- **It is the scheduler.** It emits the `cron.*.tick` events and answers them;
  the daily data jobs are the chart's courier CronJobs posting a station.
- Sweeps are synchronous on purpose: the caller opens a `pipeline.job_runs` row
  and closes it with the returned summary. A refusal throws — a sweep that did
  not run is never logged as one that did.
- Holds a Postgres pool and a GitHub App — `/healthz` answers 503 while Postgres is unreachable.

## Develop

```bash
npm install                              # from the repo root (workspace member)
npm run build -w @re-cinq/lore-stations
npm test  -w @re-cinq/lore-stations
```

Depends on `@re-cinq/lore-shared` and `@re-cinq/lore-assembly-lines` — build
those first, or use the root `npm run build` which orders them.

## Deploy

Shipped as the `lore-stations` Service (port 8080) in the **`lore-stations`**
namespace, subchart `stations-helm` of the `lore-platform` umbrella chart
(single replica — the 409 latch is per-process).

| Env var | Purpose |
| --- | --- |
| `PORT` | HTTP port (default 8080) |
| `LORE_DB_HOST` / `_PORT` / `_NAME` / `_USER` / `_PASSWORD` | Postgres pool |
| `LORE_INGEST_TOKEN` | bearer the routes require — the Floor presents the same secret (`lore-agent-internal-token`) |
| `GITHUB_APP_ID` / `_PRIVATE_KEY` / `_INSTALLATION_ID` | GitHub App — merge-check merges PRs, comments, reads CI |
| `ANTHROPIC_API_KEY` | optional — auto-curation's Haiku lesson; absent, the step is skipped |
