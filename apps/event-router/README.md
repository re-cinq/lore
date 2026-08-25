# Lore Event Router (`@re-cinq/lore-event-router`)

The **sole writer** of the `pipeline.events` table — a small hapi service that
every producer reports events to and that serves claims to whoever consumes
them. It produces events and nothing else: no drain loop, no job handlers, no
Agent CR dispatch. See
[ADR-044](../../adrs/ADR-044-event-router-owns-the-event-bus.md) for why the
bus got a single owning deployable, and
[ADR-024](../../adrs/ADR-024-ubiquitous-language-execution-model.md) for the
three-powers test that says event production was never a Floor power. Runs as
one replica in the `lore-event-router` namespace on GKE.

## One front door, every producer

`POST /api/events` is the single write path. One path, two authentication
branches, decided by the presence of GitHub's own signature header:

- **GitHub webhooks** carry `X-Hub-Signature-256` and are verified by HMAC over
  the raw body (`LORE_WEBHOOK_SECRET`), then mapped to `github.*` events by the
  pure `mapGitHubEvent`. One delivery may fan out to several events.
- **Every other producer** — the Agent CR watch, k8s reconcile re-emits, cron
  ticks, CI ingest, human-station resumes, internal ingest triggers — presents
  a bearer token and reports the generic `EventInsert` shape, inserted
  verbatim. The `source` field is a closed vocabulary; a typo is refused at the
  door rather than sitting unhandled.

Returns `202` fast; every insert is idempotent on `dedupeKey`, so a redelivery
collapses to one row. The body cap is 25 MB — GitHub's own webhook ceiling.

Producers select their reporter via `selectEventReporter`
(`libs/shared/src/project/events/select-event-reporter.ts`): with
`EVENT_ROUTER_URL` set they report over HTTP with the service-to-service token
(`LORE_AGENT_INTERNAL_TOKEN`, falling back to `LORE_INGEST_TOKEN`); without it
— local `npm start`, no router — they fall back to the pool they already hold.
The choice is logged once at boot.

## The consume side

The router also serves the endpoints the Floor drains through. No consume
endpoint can write an event — producing and draining are different privileges,
even when one process does both. The atomicity is unchanged: `claimBatch` is
one `FOR UPDATE SKIP LOCKED` statement server-side, so concurrent claimants
get disjoint batches.

| Route | Purpose |
| --- | --- |
| `POST /api/events` | The front door — report an event (webhook or bearer) |
| `POST /api/events/claim` | Claim a batch from the shared queue |
| `POST /api/events/{id}/ack` | Mark a claimed event done |
| `POST /api/events/{id}/fail` | Return an event for retry after backoff |
| `POST /api/events/{id}/dead` | Dead-letter (the drainer's judgement, not the router's) |
| `POST /api/events/reap` | Recover rows a crashed claimer left in flight |
| `POST /api/events/prune` | Delete handled rows older than N days |
| `POST /api/subscriptions` | Register a subscriber's event subscriptions |
| `POST /api/deliveries/claim` | Claim a subscriber's own delivery rows |
| `POST /api/deliveries/{id}/ack` / `fail` / `dead` | Transition one delivery |
| `POST /api/deliveries/reap` | Reap stuck deliveries (per-row visibility timeout) |
| `POST /api/deliveries/prune` / `reconcile` / `orphaned` | Retention, missed-delivery backfill, zero-delivery events |

The `/api/deliveries/*` family is the fan-out amendment in ADR-044: one
`pipeline.event_deliveries` row per `(event, subscriber)`, so a subscriber that
was down drains its own backlog instead of losing rows to whoever was awake.

## The Agent-CR watch

The router holds the streaming Kubernetes watch on Agent CRs
(`src/listeners/k8s-watch.ts` is the connection — reconnect, backoff, paginated
catch-up; `src/listeners/agent-reporting.ts` is the testable mapping). A
terminal CR becomes its `kubernetes.agent*` event, written through the same
insert as the route. Disabled when the station backend is not `k8s`. The
reconcile + prune safety net deliberately stays on the Floor — a backstop in
the same process as the watch it backs up dies with it.

## Boundaries (what this service is not)

- **Not the drainer.** The Floor's loop claims, acks, and dead-letters through
  the routes above; the retry budget is the drainer's knowledge, not the
  router's.
- **Not cluster authority.** Watching a CR complete is observation; creating
  one is dispatch, and dispatch stays on the Floor.
- **"Sole writer" has two atomic exceptions.** `insertStart`/`insertForkRerun`
  in `assembly-runs-pg.ts` write `assembly_run.start` inside the same CTE as
  the run row; they compose the shared insert clause, and CI fails any insert
  site that does neither (ADR-044 amendment).
- **Webhook cutover in progress.** Onboarded repos' `LORE_WEBHOOK_URL` still
  points at the Floor's `POST /api/webhook/github`, which now reports through
  the router like any other producer. The router's GitHub branch is live; the
  Floor route can be deleted only after every webhook is re-pointed —
  reversing that order drops deliveries.

## Develop

```bash
npm install                                   # from the repo root (workspace member)
npm run build -w @re-cinq/lore-event-router
npm test  -w @re-cinq/lore-event-router       # vitest; roundtrip suites drive client + routes against each other
```

Depends on `@re-cinq/lore-shared` (build it first, or use the root
`npm run build`). `buildServer` does not listen, so tests drive it with
`inject()`.

## Deploy

Built via [`Dockerfile`](./Dockerfile) into `ghcr.io/re-cinq/lore-event-router`
by [`build-event-router.yml`](../../.github/workflows/build-event-router.yml),
shipped as the `event-router-helm` subchart of the `lore-platform` umbrella
into the `lore-event-router` namespace (port 8080, `/healthz` answers 503 when
Postgres does not — GitHub redelivers a 5xx, but a 202 the router never earned
is lost). One replica: two routers would double-observe every terminal CR
(dedupe makes that a cost, not a correctness, question).

| Env var | Purpose |
| --- | --- |
| `PORT` | Listen port (default 8080) |
| `LORE_DB_HOST` / `_PORT` / `_NAME` / `_USER` / `_PASSWORD` | The Postgres pool — the router is the process that keeps one |
| `LORE_WEBHOOK_SECRET` | HMAC secret for the GitHub branch; must equal each repo webhook's secret |
| `LORE_INGEST_TOKEN` | Bearer the reporting and consume branches accept — mounted from the `lore-agent-internal-token` secret, the same token producers present |
| `LORE_STATION_BACKEND` | `k8s` enables the Agent-CR watch; anything else disables it |
| `LORE_AGENTS_NAMESPACE` | Namespace the watch observes (must match the chart's RBAC grant) |
