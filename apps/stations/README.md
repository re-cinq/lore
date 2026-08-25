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
map, the drain subscriptions, and the pod runner can never drift:

- **Sweeps** (`http` + `cron` triggers) — served at `POST /api/stations/{name}`
  (synchronous; returns `{ summary }`; 404 unknown name, 409 already running via
  an in-process latch, hence `replicaCount: 1`).
- **Service nodes** (`node`, `runtime: "service"`) — assembly-line nodes run
  in-process: the walk publishes the node onto the bus and this service's
  **drain loop** (`src/drain/`) claims it from `pipeline.event_deliveries` as
  subscriber `stations` (ADR-044 amendment), alongside any `event` triggers.
- **Pod nodes** (`node`, `runtime: "pod"`) — run one-per-pod by the
  `lore-station <type> '<station_input>'` CLI (`src/cli/main.ts`), dispatched by
  the ai-agent-subsystem's exec vendor; it prints the `LORE_NODE_RESULT`
  terminal line.
- **Human stations** (`human`) — manifest-only; a person behind a route, no
  `run`.

| Station | Form | Trigger / runtime |
| --- | --- | --- |
| `merge-check` | sweep | cron `*/1 * * * *` (Floor tick) + http |
| `approval-check` | sweep | event `github.issues.labeled` + cron `23 * * * *` + http |
| `backfill-scan` | sweep | cron Mon 11:00 + http |
| `memory-ttl` | sweep | cron hourly (chart courier CronJob) + http |
| `importance-decay` | sweep | cron 05:00 (courier CronJob) + http |
| `anthropic-cost-sync` | sweep | cron 07:00 (courier CronJob) + http |
| `escalation-step` | node | service, 5m |
| `issues` | node | service, 10m |
| `merge-step` | node | service, 5m |
| `retrospective` | node | service, 10m |
| `comment-triage` | node | pod, 5m |
| `detect` | node | pod, 30m |
| `ingest` | node | pod (clone), 10m |
| `validate` | node | pod (clone), 15m |
| `feature-review` | human | node type `feature_review` |
| `pr-review` | human | node type `pr_review` |

## `lore-stations` vs `lore-station` (one letter, two images)

Both images build from **this package** — there is no separate
`apps/lore-station` directory. [`Dockerfile`](./Dockerfile) builds
`ghcr.io/re-cinq/lore-stations`, the pooled HTTP service described here.
[`Dockerfile.pod`](./Dockerfile.pod) builds `ghcr.io/re-cinq/lore-station`, the
pod image whose entrypoint is the `lore-station` CLI shim running one non-agent
assembly-line node per pod. A station change rebuilds both
(`build-stations.yml` / `build-lore-station.yml`).

## Boundaries

- **Schedules nothing itself.** Cron ticks come from the Floor's scheduler or
  the chart's courier CronJobs; this process only answers, drains, and serves.
- Sweeps are synchronous on purpose: the caller opens a `pipeline.job_runs` row
  and closes it with the returned summary. A refusal throws — a sweep that did
  not run is never logged as one that did.
- Holds a Postgres pool and a GitHub App (unlike the pod form, which reaches
  data over HTTP) — `/healthz` answers 503 while Postgres is unreachable.

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
