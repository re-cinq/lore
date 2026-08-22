---
adr_number: 44
title: "One writer for pipeline.events, and a Floor that holds no pool"
status: in progress
date: 2026-08-22
domains: [floor, api, infra, events, packaging]
---

# ADR-044: `event-router` owns the event bus

This ADR gives `pipeline.events` a single owning service — a new `event-router`
deployable that every producer reports to and that serves claims to whoever
drains — and makes the Floor a database-less deployable that reaches all of its
data over HTTP, so a Floor can run in a cluster the database does not reach.

## Context

Two facts about today's system push in the same direction.

**The Floor holds a Postgres pool.** That is what stands between the single
cluster running now and a Floor running anywhere else. A satellite cluster's
Kubernetes API is only reachable from inside that cluster, but observing it
today means writing straight to a database a satellite has no credentials for.
[ADR-032](./ADR-032-split-local-remote-api.md) already solved this exact shape
for `apps/mcp-server` — it holds no pool and proxies every data operation to
`lore-api` over HTTPS. Nothing about that reasoning was specific to the MCP
adapter.

**`pipeline.events` has many writers.** The Floor's Kubernetes watch, its
GitHub webhook route, its cron-tick emitter, its CI-ingest routes, lore-api's
`internal.ingest.*` triggers, and `reportToParkedNode` (which serves both the
human-station resume and the spec-PR-merge resume) each hold their own pool and
call `insertEvent()` in process. Six producers, six pools, one table.

[ADR-024](./ADR-024-ubiquitous-language-execution-model.md)'s three-powers test
already says what a Floor is for: cluster authority, the drain loop, and the
in-process SSE bus. *Producing* events — receiving a webhook, watching a CR for
completion, reporting a person's decision — is none of the three. It was only
ever there because that is where the pool happened to be.

## Decision

**A new deployable, `apps/event-router`, is the only writer of
`pipeline.events`.** It receives every event through one endpoint and serves
claims to whoever drains the queue. The Floor keeps exactly the three powers
ADR-024 pins to it and reaches every byte of its data over HTTP.

### One endpoint, every producer

- `POST /api/events` is the single front door, and every producer uses it —
  GitHub webhooks, the Kubernetes watch, human-station resumes, cron ticks,
  CI-ingest, and the internal ingest triggers alike. A producer reports the
  whole `EventInsert` verbatim; the router does not reshape it. ([validated by posts the whole EventInsert](libs/shared/src/project/events/event-reporter-http.test.ts#L20))
- A report that does not land throws rather than resolving. An event that fails
  to insert loses the work it was meant to start, and a producer that reports
  success anyway converts that loss into silence — which is how a resume behind
  a `202` went missing before (FR6.32). ([validated by throws on a refusal rather than losing the event silently](libs/shared/src/project/events/event-reporter-http.test.ts#L53))
- The route carries two authentication branches, not two routes: GitHub sends
  its native webhook body with `X-Hub-Signature-256`, verified by HMAC over the
  raw body; every other producer sends the generic shape with a bearer token.
  Multiplexing an untrusted external caller and a trusted internal one on one
  path means the branch cannot be a single hapi auth strategy — both checks run
  in sequence inside the handler. That is the price of one front door, and it
  is worth paying: a producer should not have to know which door its event
  qualifies for.

### What moves, and what deliberately does not

- The **streaming Kubernetes watch** moves into `event-router`. It is pure
  observation and needs only a kubeconfig.
- The **reconcile + prune safety net** stays in the Floor. A backstop living in
  the same process as the thing it catches failures of is a weaker backstop — a
  wedged `event-router` would take the watch and its own safety net down
  together. Its "is this still open, worth re-emitting" check also reads
  business state the router has no other reason to know, and the Floor already
  holds a Kubernetes client for dispatch.
- **Dispatching Agent CRs stays in the Floor.** Creating a CR is cluster
  authority; watching one complete is not. The split is between acting on the
  cluster and observing it.

### The Floor loses its pool

Reaching the queue over HTTP is not enough on its own — a Floor that still
opens a pool for everything else has not moved. So `lore-api` grows the write
and claim endpoints the Floor needs (leases, job-run writes, audit writes,
usage writes, agent-run telemetry, the task-queue operations beyond the
spec-task subset), and the ports behind them gain HTTP adapters following the
`AgentDefsHttp` template already in the tree.

Leader election is the one piece with no HTTP answer: `single-instance.ts`
holds a `pg_try_advisory_lock` on a dedicated connection, which is a session
lock and cannot be proxied. It is replaced by a Kubernetes
`coordination.k8s.io` Lease — the Floor already has a client and cluster
authority, so this adds no dependency and needs no database.

## Consequences

- A satellite Floor becomes a deployment decision rather than a rewrite: it
  runs the same binary with `LORE_DB_HOST` unset, reports what it observes to
  the central router, and claims work back from it.
- The drain loop becomes HTTP polling with claim latency. The atomicity does
  not change — `FOR UPDATE SKIP LOCKED` stays inside one statement server-side,
  so the HTTP call only wraps it and concurrent claimants remain safe.
- The GitHub webhook URL changes for every onboarded repo. The router must be
  standing and the webhooks re-pointed before the Floor's route is deleted;
  reversing that order drops deliveries.
- `event-router` becomes a new single point of failure for event ingestion,
  which the Floor's retained reconcile pass partially offsets for the
  Kubernetes half and GitHub's own delivery retries offset for the other.
- Three ports the Floor leans on hardest — `repo`, `issues`, `pulls` — need no
  work at all: they resolve to `PlatformGitHub` and were never Postgres. The
  cost of this decision is concentrated in the queue and the handful of
  genuinely DB-backed ports, not spread across every call site.

## Alternatives considered

- **Keep the listeners in the Floor and give it an HTTP write path only.**
  Cheaper, but leaves the Floor doing event production that ADR-024 says is not
  one of its powers, and leaves six writers on one table.
- **Have `lore-api` own `pipeline.events` too.** One fewer deployable, but it
  makes the request-serving API also the queue broker, and gives the Floor's
  hot drain path a dependency on the same service serving the web UI.
- **Skip the router; have producers write through `lore-api`.** The event
  ingest would then take an extra hop for no gain, and the "one owner" property
  would be a convention rather than a boundary.
