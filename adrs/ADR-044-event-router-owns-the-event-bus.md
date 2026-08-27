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
  whole `EventInsert` verbatim; the router does not reshape it. ([validated by posts the whole EventInsert](libs/shared/src/project/events/event-reporter-http.test.ts#L21))
- A report that does not land throws rather than resolving. An event that fails
  to insert loses the work it was meant to start, and a producer that reports
  success anyway converts that loss into silence — which is how a resume behind
  a `202` went missing before (FR6.32). ([validated by throws on a refusal rather than losing the event silently](libs/shared/src/project/events/event-reporter-http.test.ts#L54))
- The route carries two authentication branches, not two routes. Multiplexing
  an untrusted external caller and a trusted internal one on one path means the
  branch cannot be a single hapi auth strategy — both checks run in sequence
  inside the handler. That is the price of one front door, and it is worth
  paying: a producer should not have to know which door its event qualifies
  for.
- GitHub is recognised by its own `X-Hub-Signature-256` header and
  authenticated by HMAC over the raw body — it carries no bearer token and is
  never asked for one. ([validated by captures a signed webhook without any bearer token](apps/event-router/src/delivery/routes/events.test.ts#L37))
- A Floor calling any of the three new services presents the SERVICE-TO-SERVICE
  token (`LORE_AGENT_INTERNAL_TOKEN`), not the org-wide ingest token, falling
  back to the latter only for local dev where one token serves both ends. The
  charts mount the internal token; a client sending the ingest one answered 401
  on every call — the event drain, station runs and agent dispatch at once
  (2026-08-24 cutover). Each end was correct alone; only the pair was wrong.
  ([validated by prefers the service-to-service token over the org ingest token](libs/shared/src/http/internal-token.test.ts#L5), [`internal-token.test.ts:14`](libs/shared/src/http/internal-token.test.ts#L14), [`internal-token.test.ts:18`](libs/shared/src/http/internal-token.test.ts#L18), [`internal-token.test.ts:22`](libs/shared/src/http/internal-token.test.ts#L22))
- A webhook whose signature does not verify is refused and writes nothing.
  ([validated by refuses a webhook whose signature does not match the secret](apps/event-router/src/delivery/routes/events.test.ts#L60))
- Every other producer authenticates with a bearer token and reports the
  generic shape, which is inserted unchanged. ([validated by inserts a reported event verbatim for a valid bearer token](apps/event-router/src/delivery/routes/events.test.ts#L86))
- A reported event with no bearer token is refused, so the trusted branch
  cannot be reached by omitting credentials rather than presenting bad ones.
  ([validated by refuses a reported event carrying no bearer token](apps/event-router/src/delivery/routes/events.test.ts#L98))
- A source outside the known vocabulary is refused at the door. An event whose
  source is a typo reaches no handler and would be discovered only by its
  absence. ([validated by refuses a source outside the known vocabulary](apps/event-router/src/delivery/routes/events.test.ts#L109))
- A malformed body is refused with the parser's own complaint, which names the
  offending position. ([validated by refuses a body that is not JSON](apps/event-router/src/delivery/routes/events.test.ts#L121))
- A rejection that belongs to no field names the body itself rather than an
  empty path. ([validated by names the body itself when the payload is not even an object](apps/event-router/src/delivery/routes/events.test.ts#L161))
- One webhook may carry several events — a check suite fans out to one per
  backing PR — and every one is reported. ([validated by reports every event a single webhook fans out to](apps/event-router/src/delivery/routes/events.test.ts#L136))

### The watch reports what it observes

**Amendment (2026-08-25): the watch moved to cluster-agent.** This ADR recorded
the router as the process holding it, which put a Kubernetes client in two
places and contradicted the standing invariant that cluster-agent is the only
one. The exception looked justified — a WATCH is reachable only from inside its
own cluster — but that is the argument for the move, not against it: the process
inside the cluster IS cluster-agent. The decisive consequence is scale. A router
that watches directly can only ever watch the cluster it runs in; one
cluster-agent per cluster, each reporting terminal phases inward over HTTP, is
what allows more than one execution cluster. The router keeps its place as the
sole WRITER of `pipeline.events` — cluster-agent reports through the same
`POST /api/events` front door every other producer uses, so nothing about this
boundary changes except who opens the connection.

A report is now a network call rather than a write on the reporting process's own
pool, so it retries before giving up. Every event `mapAgentToEvent` produces
carries a `dedupeKey`, which is what makes repeating one safe.

- A terminal Agent CR becomes its kubernetes event. ([validated by reports a terminal Agent CR as its kubernetes event](apps/cluster-agent/src/listeners/agent-reporting.test.ts#L44))
- A CR that has not reached a terminal phase reports nothing, so the repeated
  MODIFIED notifications a running pod generates cost one map and no row.
  ([validated by reports nothing for a CR that has not reached a terminal phase](apps/cluster-agent/src/listeners/agent-reporting.test.ts#L65))
- A failed report is swallowed here, unlike everywhere else this repo reports
  events: the caller is a watch callback with nobody to return a status to, so
  throwing would end the stream over one CR, and the Floor's reconcile pass
  re-emits what was missed. ([validated by swallows a failed report so one bad CR cannot end the watch](apps/cluster-agent/src/listeners/agent-reporting.test.ts#L79))
- A report retries before it is given up on, because it now crosses a network
  rather than writing to this process's own pool — and a dropped terminal event
  leaves its node open until the reaper, which is the failure the bus exists to
  remove. Repeating one is safe: every event `mapAgentToEvent` produces carries a
  `dedupeKey`. ([validated by retries a failed insert, since the report now crosses a network](apps/cluster-agent/src/listeners/agent-reporting.test.ts#L157), [`agent-reporting.test.ts:178`](apps/cluster-agent/src/listeners/agent-reporting.test.ts#L178))
- The catch-up pass walks the namespace one page at a time. 180 accumulated CRs
  in a single unpaginated LIST blew Node's heap and crash-looped the Floor on
  2026-07-24. ([validated by walks every page rather than holding the namespace at once](apps/cluster-agent/src/listeners/agent-reporting.test.ts#L99), [`agent-reporting.test.ts:112`](apps/cluster-agent/src/listeners/agent-reporting.test.ts#L112), [`agent-reporting.test.ts:137`](apps/cluster-agent/src/listeners/agent-reporting.test.ts#L137))

### The router serves the drain loop

The Floor drains a queue it neither owns nor writes to. Six endpoints, matching
exactly the calls the loop and its reaper make — and no endpoint here writes an
event, because producing and draining are different privileges even when one
process happens to do both.

- A claim hands the caller a batch. ([validated by hands a claimed batch to the caller that asked for it](apps/event-router/src/delivery/routes/event-queue.test.ts#L28))
- The atomicity is unchanged: `FOR UPDATE SKIP LOCKED` is still one statement,
  now on the router's side of the call, so two drainers claiming at once still
  receive disjoint batches. ([validated by claims nothing twice, so two drainers cannot run the same event](apps/event-router/src/delivery/routes/event-queue.test.ts#L46))
- A busy serial family can be held back at claim time, so its waiting rows stay
  `pending` rather than being parked in `processing` and reaped as presumed
  dead. ([validated by holds back an excluded event name](apps/event-router/src/delivery/routes/event-queue.test.ts#L67))
- An acked event is not handed out again. ([validated by marks a claimed event done](apps/event-router/src/delivery/routes/event-queue.test.ts#L82))
- A failed event returns for another attempt after its backoff. ([validated by fails a claimed event back for another attempt after its backoff](apps/event-router/src/delivery/routes/event-queue.test.ts#L96))
- Dead-lettering is its own endpoint, not a flag on failure: whether an event
  has run out of attempts is the DRAINER's judgement, and folding the two
  together would move that decision to a service that does not know the retry
  budget. ([validated by dead-letters an event that has run out of attempts](apps/event-router/src/delivery/routes/event-queue.test.ts#L111))
- The reaper recovers rows a crashed claimer left in flight, and prunes handled
  ones. ([validated by reaps rows a crashed claimer left in flight](apps/event-router/src/delivery/routes/event-queue.test.ts#L127), [`event-queue.test.ts:142`](apps/event-router/src/delivery/routes/event-queue.test.ts#L142))
- Draining requires the same token reporting does. ([validated by refuses to hand out a batch to a caller with no token](apps/event-router/src/delivery/routes/event-queue.test.ts#L156), [`event-queue.test.ts:164`](apps/event-router/src/delivery/routes/event-queue.test.ts#L164))
- The client and the routes are two halves of one contract written apart, so
  they are exercised against each other rather than each against its own idea
  of the other. ([validated by reports an event and claims it back](apps/event-router/src/delivery/routes/event-queue-roundtrip.test.ts#L56), [`event-queue-roundtrip.test.ts:63`](apps/event-router/src/delivery/routes/event-queue-roundtrip.test.ts#L63), [`event-queue-roundtrip.test.ts:72`](apps/event-router/src/delivery/routes/event-queue-roundtrip.test.ts#L72), [`event-queue-roundtrip.test.ts:81`](apps/event-router/src/delivery/routes/event-queue-roundtrip.test.ts#L81), [`event-queue-roundtrip.test.ts:90`](apps/event-router/src/delivery/routes/event-queue-roundtrip.test.ts#L90), [`event-queue-roundtrip.test.ts:99`](apps/event-router/src/delivery/routes/event-queue-roundtrip.test.ts#L99))

### Every other producer reports through the router

A producer keeps its code and its location; only its write changes. The
selection is the same three-way shape `agentDefs` already uses:

- A producer that can see the router reports over HTTP, and never resolves the
  pool it would otherwise fall back to. ([validated by reports over HTTP when EVENT_ROUTER_URL names a router](libs/shared/src/project/events/select-event-reporter.test.ts#L9), [`select-event-reporter.test.ts:19`](libs/shared/src/project/events/select-event-reporter.test.ts#L19))
- One that cannot falls back to the pool it already holds, which is what keeps
  a local `npm start` — a Floor and a Postgres, no router — working. ([validated by falls back to the local queue when EVENT_ROUTER_URL is unset](libs/shared/src/project/events/select-event-reporter.test.ts#L35))
- The choice is logged at construction, because the fallback is right locally
  and wrong in a cluster: a deployment that means to route and has lost
  `EVENT_ROUTER_URL` would write directly and look perfectly healthy. ([validated by says which way it resolved](libs/shared/src/project/events/select-event-reporter.test.ts#L47))

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

## Amendment (2026-08-23): the Floor keeps its pool

The second half of this ADR — "the Floor loses its pool" — was planned as a set
of lore-api routes covering the ~70 repository methods the Floor calls. That
count was the signal that the cut was wrong: 152 of the Floor's ~164 data calls
are made by job handlers, not by the Floor, so the plan amounted to tunnelling
each handler's data through HTTP to keep it running in a process it did not
belong in.

Those routes are not being built. Instead, handlers that are self-contained
units of work move to where the data already is — see
[ADR-024](./ADR-024-ubiquitous-language-execution-model.md)'s service-station
amendment, and `apps/stations`. The first two, `merge-check` and
`approval-check`, moved verbatim.

The Floor therefore keeps its pool for now: `task/` (49 data calls) and
`watcher/` (39) are station-startup and cluster-authority infrastructure, and
stay. Everything in the first half of this ADR — the event-router owning
`pipeline.events`, every producer reporting to it, the Floor claiming and acking
over HTTP — is unaffected and shipped.

Multi-cluster, the original motivation, is left open. Should it be taken up, the
cheaper cut is the mirror of the one rejected here: the Floor's **cluster**
surface is 15 calls across 7 operation types (`get`/`list`/`create`/`delete`/
`replace` CustomObject, `readNamespacedPodLog`, `listNamespacedPod`), so
extracting a thin per-cluster agent and leaving the brain central costs far less
than moving the data. Recorded so it need not be measured again.

## Amendment (2026-08-24): a delivery row per subscriber

This ADR describes `pipeline.events` as a queue with one drainer. That is what it
is — one row per event, claimed `FOR UPDATE SKIP LOCKED` — and it means exactly
one consumer ever sees a given event. So a second consumer cannot be added by
configuration: any process that drains alongside the Floor STEALS its rows, and
one that finds no handler for a stolen name dead-letters it immediately, with no
retry, because an unknown name is a config error rather than a transient one.

Stations need to react to events they name. That requires fan-out, which a work
queue does not have, so `pipeline.event_deliveries` carries one row per
`(event, subscriber)` and the claim moves onto it. Subscribers declare what they
want in `pipeline.event_subscriptions` and register at boot; the Floor becomes
one subscriber among several rather than the drainer.

The property this buys that motivated it: a subscriber that was down does not
miss what happened. Its delivery rows accumulate and it drains its own backlog
when it returns — where a shared queue would have handed those events to whoever
was awake.

It also removes a footgun rather than relocating it. A consumer now only ever
receives names it subscribed to, so "no handler for this event" stops being
reachable. The failure it is replaced by is quieter and must be instrumented: an
event whose name nobody subscribed to gets no deliveries at all and simply sits
until pruned, so recent events with zero deliveries are surfaced, and a boot-time
reconcile creates the deliveries a subscriber missed between deploying and
registering.

### The "sole writer" claim, resolved rather than restated

The decision above says every producer reports through the router. Three writers
do not, and cannot:
`insertStart`/`insertForkRerun` in
[assembly-runs-pg.ts](../libs/shared/src/project/assembly-runs/assembly-runs-pg.ts)
write `assembly_run.start` inside the same CTE as the run row it names, because a
run row without its start event never runs and an event naming a run that does
not exist is worse; and a settings write in
[repo-settings.ts](../apps/lore-api/src/api/routes/repos/repo-settings.ts) rolls
its own insert with no such excuse.

Fan-out therefore cannot live in the router's handler, or the atomic writers
would produce events with no deliveries and every assembly line in the factory
would stop with nothing logged. It is instead ONE exported SQL clause composed
into the same statement as each insert. The third writer loses its hand-rolled
insert and calls the shared one, so what remains is two writers that must be
atomic and one shared definition of what an insert means.

A database trigger would have made this unforgettable, and is rejected: the
schema is pure DDL across every migration, so a trigger would be the first stored
procedure in the system — untestable by the unit suite, invisible to TypeScript,
and revisable only through a migration runner that is append-only and
skip-by-filename, where editing an applied file is silently inert. The
forgettability is closed in CI instead, by a test that fails when an event-insert
site neither is the shared writer nor composes the shared clause.

### The reaper's timeout stops being global

`VISIBILITY_TIMEOUT_SECONDS` presumed every handler dead at ten minutes,
regardless of the budget its work declared. A longer handler was re-queued while
still running, executed concurrently with itself, and burned its attempts until
it dead-lettered — on every run, deterministically. The delivery row carries the
timeout its subscriber declared, so a handler is presumed dead at its own budget.
No handler exceeds the old ceiling today, which is why this never fired; it is
fixed now because the table is being created now and the next long handler should
fail loudly rather than silently double-execute.

## Amendment (2026-08-26): multi-cluster is taken up, in the recorded shape

The 2026-08-23 amendment left multi-cluster open and recorded the cheaper cut
for whenever it was taken up: extract a thin per-cluster agent, leave the brain
central. It is now being taken up, and in exactly that shape —
`specs/running-stations-in-any-k8s-cluster/spec.md` registers additional
execution clusters as further instances of the existing cluster-agent (plus the
ai-agents subsystem, via a standalone chart), never as a second Floor. The one
structural change it adds on top of this ADR: node dispatch flips from the
Floor pushing to one configured `CLUSTER_AGENT_URL` to cluster-agents claiming
queued station runs over HTTP, because a satellite cluster is unreachable for
inbound calls. Reporting is untouched — every cluster-agent already reports
terminal phases through the router's front door with dedupe keys, which is what
makes a claim executed far away indistinguishable from one executed at home.

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
