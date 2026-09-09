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
  whole `EventInsert` verbatim; the router does not reshape it. ([validated by posts the whole EventInsert](libs/shared/src/outbound/project/events/event-reporter-http.test.ts#L20))
- A report that does not land throws rather than resolving. An event that fails
  to insert loses the work it was meant to start, and a producer that reports
  success anyway converts that loss into silence — which is how a resume behind
  a `202` went missing before (FR6.32). ([validated by throws on a refusal rather than losing the event silently](libs/shared/src/outbound/project/events/event-reporter-http.test.ts#L53))
- The route carries two authentication branches, not two routes. Multiplexing
  an untrusted external caller and a trusted internal one on one path means the
  branch cannot be a single hapi auth strategy — both checks run in sequence
  inside the handler. That is the price of one front door, and it is worth
  paying: a producer should not have to know which door its event qualifies
  for.
- GitHub is recognised by its own `X-Hub-Signature-256` header and
  authenticated by HMAC over the raw body — it carries no bearer token and is
  never asked for one. ([validated by captures a signed webhook without any bearer token](apps/event-router/src/transport/routes/events.test.ts#L39))
- A Floor calling any of the three new services presents the SERVICE-TO-SERVICE
  token (`LORE_AGENT_INTERNAL_TOKEN`), not the org-wide ingest token, falling
  back to the latter only for local dev where one token serves both ends. The
  charts mount the internal token; a client sending the ingest one answered 401
  on every call — the event drain, station runs and agent dispatch at once
  (2026-08-24 cutover). Each end was correct alone; only the pair was wrong.
  The rule binds every service-to-service caller, not the Floor alone: lore-api's
  cluster-agent client sent the ingest token until 2026-08-29, so a recipe saved
  in the `/agents` UI wrote its row and then 401'd on the catalog apply, leaving
  the cluster running the previous recipe. Which credential a client presents is
  therefore a named, tested function rather than an env read at the call site.
  ([validated by prefers the service-to-service token over the org ingest token](libs/shared/src/lib/internal-token.test.ts#L5), [`internal-token.test.ts:14`](libs/shared/src/lib/internal-token.test.ts#L14), [`internal-token.test.ts:18`](libs/shared/src/lib/internal-token.test.ts#L18), [`internal-token.test.ts:22`](libs/shared/src/lib/internal-token.test.ts#L22), [presents the service-to-service token the cluster-agent's guard mounts](apps/lore-api/src/work/agents/agent-crd-k8s.test.ts#L5), [`agent-crd-k8s.test.ts:18`](apps/lore-api/src/work/agents/agent-crd-k8s.test.ts#L18), [`agent-crd-k8s.test.ts:30`](apps/lore-api/src/work/agents/agent-crd-k8s.test.ts#L30))
- A webhook whose signature does not verify is refused and writes nothing.
  ([validated by refuses a webhook whose signature does not match the secret](apps/event-router/src/transport/routes/events.test.ts#L118))
- Every other producer authenticates with a bearer token and reports the
  generic shape, which is inserted unchanged. ([validated by inserts a reported event verbatim for a valid bearer token](apps/event-router/src/transport/routes/events.test.ts#L144))
- A reported event with no bearer token is refused, so the trusted branch
  cannot be reached by omitting credentials rather than presenting bad ones.
  ([validated by refuses a reported event carrying no bearer token](apps/event-router/src/transport/routes/events.test.ts#L156))
- A source outside the known vocabulary is refused at the door. An event whose
  source is a typo reaches no handler and would be discovered only by its
  absence. ([validated by refuses a source outside the known vocabulary](apps/event-router/src/transport/routes/events.test.ts#L167))
- A malformed body is refused with the parser's own complaint, which names the
  offending position. ([validated by refuses a body that is not JSON](apps/event-router/src/transport/routes/events.test.ts#L179))
- A rejection that belongs to no field names the body itself rather than an
  empty path. ([validated by names the body itself when the payload is not even an object](apps/event-router/src/transport/routes/events.test.ts#L219))
- One webhook may carry several events — a check suite fans out to one per
  backing PR — and every one is reported. ([validated by reports every event a single webhook fans out to](apps/event-router/src/transport/routes/events.test.ts#L194))

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

- A terminal Agent CR becomes its kubernetes event. ([validated by reports a terminal Agent CR as its kubernetes event](apps/cluster-agent/src/events/listeners/agent-reporting.test.ts#L8))
- A CR that has not reached a terminal phase reports nothing, so the repeated
  MODIFIED notifications a running pod generates cost one map and no row.
  ([validated by reports nothing for a CR that has not reached a terminal phase](apps/cluster-agent/src/events/listeners/agent-reporting.test.ts#L41))
- A report retries before it is given up on, because it now crosses a network
  rather than writing to this process's own pool — and a dropped terminal event
  leaves its node open until the reaper, which is the failure the bus exists to
  remove. Repeating one is safe: every event `mapAgentToEvent` produces carries a
  `dedupeKey`. The ladder itself moved to the shared `EventProxy` on 2026-08-28,
  so it is no longer the watch's to own — or to have alone. ([validated by retries a blip and reports the message on the next attempt](libs/shared/src/outbound/project/events/event-proxy.test.ts#L147), [retries a blip with a delay that grows with the attempt](libs/shared/src/outbound/project/events/delivery-policy.test.ts#L25), [drops after the last attempt and names the message](libs/shared/src/outbound/project/events/event-proxy.test.ts#L188))
- A REFUSED report (401/403) re-registers before the next attempt, through the
  satellite's single-flight re-registration — the same move the claim and
  heartbeat loops already make. A satellite's per-agent token rotates whenever
  another instance of it registers (a RollingUpdate overlap did exactly that on
  2026-08-28), and a report that only retried with the rotated-out token lost
  run 595d2b0b's terminal event for good; nothing central can see a satellite's
  CR to reap it. An ordinary blip still just retries. ([validated by re-registers once on a refused credential and the retry then lands](libs/shared/src/outbound/project/events/event-proxy.test.ts#L165), [reads 401 and 403 as a refused credential](libs/shared/src/outbound/project/events/delivery-policy.test.ts#L8), [reads 503 as a blip, not a refusal, so a busy router never rotates the token](libs/shared/src/outbound/project/events/delivery-policy.test.ts#L15), [`event-reporter-http.test.ts:116`](libs/shared/src/outbound/project/events/event-reporter-http.test.ts#L116))
- The watch hands each observed CR to that proxy rather than delivering it
  itself, and a failed hand-off is swallowed here, unlike everywhere else this
  repo reports events: the caller is a watch callback with nobody to return a
  status to, so throwing would end the stream over one CR. ([validated by swallows a failed emit so one bad CR cannot end the watch](apps/cluster-agent/src/events/listeners/agent-reporting.test.ts#L59))
- The catch-up pass walks the namespace one page at a time. 180 accumulated CRs
  in a single unpaginated LIST blew Node's heap and crash-looped the Floor on
  2026-07-24. ([validated by walks every page rather than holding the namespace at once](apps/cluster-agent/src/outbound/agent-pages.test.ts#L21), [reads the raw `continue` token too, which is what the API actually sends](apps/cluster-agent/src/outbound/agent-pages.test.ts#L41), [reports no resourceVersion when a page carries none](apps/cluster-agent/src/outbound/agent-pages.test.ts#L66))

### The router serves the drain loop

The Floor drains a queue it neither owns nor writes to. The drain endpoints
match exactly the calls the loop and its reaper make — and no endpoint here
writes an event, because producing and draining are different privileges even
when one process happens to do both.

*(Amended 2026-09-09: the drained row is a `pipeline.event_deliveries` row,
one per subscriber, never `pipeline.events` itself. The original per-event
claim surface — `/api/events/claim|ack|fail|dead|reap|prune`, its
`EventQueueRepository` port and the `status`/`attempts`/`claimed_at`/
`next_attempt_at`/`handled_at`/`error` columns on `pipeline.events` — was
deleted once the delivery table took over. The columns had outlived their
last writer: every event ever captured sat at the default `pending`, and on
2026-09-09 a query grouping on that column reported a week of history as a
104,000-row undrained backlog. `pipeline.events` now records only WHAT was
captured; whether it was handled is a question for its deliveries.)*

- A claim hands the subscriber a batch of its own deliveries. ([validated by registers a subscription and claims back the event it asked for](apps/event-router/src/transport/routes/event-deliveries-roundtrip.test.ts#L46))
- The atomicity is unchanged: `FOR UPDATE SKIP LOCKED` is still one statement,
  now on the router's side of the call, so two drainers claiming at once still
  receive disjoint batches. ([validated by hands out a delivery once, then not again while it is in flight](libs/shared/src/outbound/project/events/event-deliveries.contract.test.ts#L116))
- A busy serial family can be held back at claim time, so its waiting rows stay
  `pending` rather than being parked in `processing` and reaped as presumed
  dead. ([validated by holds back an excluded name, and leaves it claimable once it is not](apps/event-router/src/transport/routes/event-deliveries-roundtrip.test.ts#L139))
- An acked delivery is not handed out again. ([validated by acks a delivery so it is not handed out again](apps/event-router/src/transport/routes/event-deliveries-roundtrip.test.ts#L70))
- A failed delivery returns for another attempt after its backoff. ([validated by fails a delivery back for another attempt after its backoff](apps/event-router/src/transport/routes/event-deliveries-roundtrip.test.ts#L83))
- Dead-lettering is its own endpoint, not a flag on failure: whether a delivery
  has run out of attempts is the DRAINER's judgement, and folding the two
  together would move that decision to a service that does not know the retry
  budget. ([validated by dead-letters a delivery that has run out of attempts](apps/event-router/src/transport/routes/event-deliveries-roundtrip.test.ts#L96))
- The reaper recovers deliveries a crashed claimer left in flight, and prunes
  handled ones. ([validated by reaps a delivery its claimer never finished](apps/event-router/src/transport/routes/event-deliveries-roundtrip.test.ts#L107), [`event-deliveries.contract.test.ts:295`](libs/shared/src/outbound/project/events/event-deliveries.contract.test.ts#L295))
- Draining requires the same token reporting does. ([validated by refuses every delivery route to a caller with no token](apps/event-router/src/transport/routes/event-deliveries-roundtrip.test.ts#L126))
- A delivery the drainer permanently gave up on is reported, grouped by
  `(event_name, subscriber)` with the error that ended the last of them, while
  one still inside its retry budget is left out. Giving up is the other silent
  failure beside an event that reached nobody, and the safety-net handlers are
  exactly the ones whose absence nobody notices: the Agent-CR reconcile tick
  dead-lettered 84 deliveries across a three-hour cluster-agent outage
  (2026-09-08) and the rows were the only record it had happened. The Floor's
  hourly prune sweep names them where it already names orphans, over the same
  window. When a group gave up more than once the NEWEST error is the one
  reported — by `handled_at`, which is not the same as storage order, so the
  in-memory double sorts rather than trusting its array. ([validated by reports a dead-lettered delivery with the error that ended it](libs/shared/src/outbound/project/events/event-deliveries.contract.test.ts#L361), [`event-deliveries.contract.test.ts:383`](libs/shared/src/outbound/project/events/event-deliveries.contract.test.ts#L383), [`event-deliveries.contract.test.ts:405`](libs/shared/src/outbound/project/events/event-deliveries.contract.test.ts#L405), [`event-deliveries.contract.test.ts:469`](libs/shared/src/outbound/project/events/event-deliveries.contract.test.ts#L469), [`cron.test.ts:164`](apps/floor/src/events/handlers/cron.test.ts#L164), [`cron.test.ts:182`](apps/floor/src/events/handlers/cron.test.ts#L182), [`cron.test.ts:200`](apps/floor/src/events/handlers/cron.test.ts#L200))
- The client and the routes are two halves of one contract written apart, so
  they are exercised against each other rather than each against its own idea
  of the other. ([validated by carries the declared timeout across the wire onto the delivery](apps/event-router/src/transport/routes/event-deliveries-roundtrip.test.ts#L59), [`event-deliveries-roundtrip.test.ts:118`](apps/event-router/src/transport/routes/event-deliveries-roundtrip.test.ts#L118))

### Every other producer reports through the router

A producer keeps its code and its location; only its write changes. The
selection is the same three-way shape `agentDefs` already uses:

- A producer that can see the router reports over HTTP, and never resolves the
  pool it would otherwise fall back to. ([validated by reports over HTTP when EVENT_ROUTER_URL names a router](libs/shared/src/outbound/project/events/select-event-reporter.test.ts#L12), [`select-event-reporter.test.ts:22`](libs/shared/src/outbound/project/events/select-event-reporter.test.ts#L22))
- One that cannot falls back to the pool it already holds, which is what keeps
  a local `npm start` — a Floor and a Postgres, no router — working. ([validated by falls back to the local queue when EVENT_ROUTER_URL is unset](libs/shared/src/outbound/project/events/select-event-reporter.test.ts#L38))
- The choice is logged at construction, because the fallback is right locally
  and wrong in a cluster: a deployment that means to route and has lost
  `EVENT_ROUTER_URL` would write directly and look perfectly healthy. ([validated by says which way it resolved](libs/shared/src/outbound/project/events/select-event-reporter.test.ts#L50))

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
[assembly-runs-pg.ts](../libs/shared/src/outbound/project/assembly-runs/assembly-runs-pg.ts)
write `assembly_run.start` inside the same CTE as the run row it names, because a
run row without its start event never runs and an event naming a run that does
not exist is worse; and a settings write in
[repo-settings.ts](../apps/lore-api/src/transport/routes/repos/repo-settings.ts) rolls
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

## Amendment (2026-08-28): one hub between a producer and the front door

`POST /api/events` settled WHERE an event goes. It never settled what a producer
does while the front door is briefly shut, and each one answered differently:
the cluster-agent's watch grew a 5x/500ms ladder with credential rotation,
`agent-reconcile` wrote `.catch(() => {})`, `pr-ready-check` swallowed per run
and marked the delivery done anyway. Three of the four answers were "lose it",
and the one that was not was reachable only by driving a Kubernetes watch.

That ladder becomes shared infrastructure. `EventProxy`
(`libs/shared/src/outbound/project/events/event-proxy.ts`) is one bounded queue, one
retry policy and one credential rotation, resolved through `selectEventProxy`
beside the three selectors already here. Producers register an `EventInput`
against it and declare only what they observed.

### Two paths, because one of them is load-bearing

- `insert` stays synchronous and propagates the sink's failure, so the proxy is
  a drop-in `EventReporter`. Three Floor ingress routes and two lore-api routes
  answer `202` only once the insert lands and turn a throw into a `500` so the
  sender redelivers; queueing underneath them would convert at-least-once
  GitHub/CI delivery into best-effort. ([validated by delivers straight to the event sink](libs/shared/src/outbound/project/events/event-proxy.test.ts#L70), [propagates the sink's failure](libs/shared/src/outbound/project/events/event-proxy.test.ts#L80), [inserts straight through to the local queue](libs/shared/src/outbound/project/events/select-event-reporter.test.ts#L66))
- `emit` queues and resolves before delivery, for producers with nobody to
  return a status to — a watch callback, a sweep — where the choice was
  previously between an inline ladder and silent loss. ([validated by resolves before the sink has delivered](libs/shared/src/outbound/project/events/event-proxy.test.ts#L93), [delivers queued messages once started](libs/shared/src/outbound/project/events/event-proxy.test.ts#L104), [queues an emitted message](libs/shared/src/outbound/project/events/select-event-reporter.test.ts#L82))
- A message is routed by its kind, so a telemetry passthrough never lands on the
  bus: `pipeline.events` is a dispatch queue with dedupe keys and handler
  fan-out, and per-tool-call volume does not belong on it. ([validated by routes each message to the sink for its kind](libs/shared/src/outbound/project/events/event-proxy.test.ts#L117), [unwraps an event message into an insert](libs/shared/src/outbound/project/events/event-sink.test.ts#L6), [refuses a telemetry message](libs/shared/src/outbound/project/events/event-sink.test.ts#L19))

### The queue is bounded and blocks, rather than growing or dropping

- A full queue BLOCKS the producer. An unbounded queue in front of an
  unreachable router grows until the process dies, and a lossy one discards
  exactly what nobody is left to re-derive; blocking pushes the pressure back to
  the only place that can decide to slow down. ([validated by blocks the producer once the queue is full](libs/shared/src/outbound/project/events/event-proxy.test.ts#L133), [leaves push pending once capacity is reached](libs/shared/src/outbound/project/events/bounded-queue.test.ts#L21), [admits the waiting producer when a shift frees the slot](libs/shared/src/outbound/project/events/bounded-queue.test.ts#L34))
- Blocked producers are admitted in arrival order, so the drain stays FIFO end
  to end even while saturated. ([validated by resolves push immediately while a slot is free](libs/shared/src/outbound/project/events/bounded-queue.test.ts#L11), [admits blocked producers in the order they arrived](libs/shared/src/outbound/project/events/bounded-queue.test.ts#L49), [returns undefined from shift on an empty queue](libs/shared/src/outbound/project/events/bounded-queue.test.ts#L64))
- Backpressure only bites if the producer AWAITS the emit; a fire-and-forget
  caller accumulates pending promises instead of items and the bound becomes
  fiction. A zero-slot queue is refused for the same reason — it would block
  forever rather than never. ([validated by rejects a capacity below 1](libs/shared/src/outbound/project/events/bounded-queue.test.ts#L68))

### The ladder, and why rotation is separate from the retry

- An ordinary failure retries with a delay that grows with the attempt. ([validated by retries a blip and reports the message on the next attempt](libs/shared/src/outbound/project/events/event-proxy.test.ts#L147), [retries a blip with a delay that grows](libs/shared/src/outbound/project/events/delivery-policy.test.ts#L25))
- A REFUSED credential rotates first and then retries, because a refusal means
  the token was rotated elsewhere. ([validated by re-registers once on a refused credential](libs/shared/src/outbound/project/events/event-proxy.test.ts#L165), [reads 401 and 403 as a refused credential](libs/shared/src/outbound/project/events/delivery-policy.test.ts#L8), [rotates the credential before retrying](libs/shared/src/outbound/project/events/delivery-policy.test.ts#L36))
- Only a `401`/`403` counts as a refusal. A timeout or a dead socket carries no
  status, and rotating the identity on every blip would churn it for nothing. ([validated by reads 503 as a blip](libs/shared/src/outbound/project/events/delivery-policy.test.ts#L15), [reads a status-less error as a blip](libs/shared/src/outbound/project/events/delivery-policy.test.ts#L19))
- The last attempt drops and NAMES the message, because the symptom of a lost
  report is otherwise silence; the Floor's reconcile cron remains the backstop. ([validated by drops after the last attempt and names the message](libs/shared/src/outbound/project/events/event-proxy.test.ts#L188), [drops after the last attempt](libs/shared/src/outbound/project/events/delivery-policy.test.ts#L47))
- A refusal at the last attempt still rotates, even though this message is lost:
  retrying five times with a rotated-out token and then giving up is precisely
  how run `595d2b0b` lost its terminal event on 2026-08-28, and rotating there
  is what keeps the NEXT one. ([validated by still rotates on a refusal at the last attempt](libs/shared/src/outbound/project/events/delivery-policy.test.ts#L58))
- A kind with no sink configured REFUSES rather than dropping quietly, so the
  ladder logs it by name — a passthrough wired on one end and not the other is
  otherwise indistinguishable from no traffic. ([validated by refuses rather than dropping](libs/shared/src/outbound/project/events/event-sink.test.ts#L34))

### Adoption: the silent-loss sites stop being silent

Four producers already had nobody to return a failure to, and each answered by
losing the event: `agent-reconcile` wrote `.catch(() => {})` twice,
`loop-run-closed`'s tick was swallowed by the `onRunClosed` hook that calls it,
`pr-ready-check` caught per run and let the delivery be marked done anyway, and
lore-api's two ingest triggers were `void`-called AND self-swallowing. All four
now `emit`, so a router blip retries instead of dropping.

- The reporting seam of each process resolves ONE proxy, memoized, because the
  queue is the proxy's own state — a second instance would be a second queue
  with nothing draining it. lore-api keys its cache on the pool the server
  injected rather than a module singleton, so one test suite's queue cannot leak
  into the next.
- A port typed on `EventReporter` reaches the queued path through a reporter
  view whose `insert` enqueues, rather than by widening every such port to take
  a proxy. ([validated by queues what a port typed on EventReporter inserts, rather than delivering inline](libs/shared/src/outbound/project/events/event-proxy.test.ts#L281))
- The 202/500 ingress routes are untouched and keep calling `insert`. A test
  that stops asserting 500 on a failed insert is the signal that the dual path
  has collapsed into the queued one and at-least-once GitHub/CI delivery is gone.
- Shutdown drains the queue after the server stops and before telemetry
  flushes — after, because an event produced by an in-flight request has to
  reach the queue first; before exit, because `process.exit` takes the queue
  with it. Every step stays best-effort: a drain that cannot finish must still
  terminate, or the zombie the shutdown handler exists to kill comes back. ([validated by drains queued events after it stops serving and before it exits](apps/floor/src/shutdown.test.ts#L25), [exits even when the event drain throws, rather than holding the rollout open](apps/floor/src/shutdown.test.ts#L44))

### Inputs, and a shutdown that says what it lost

- An input is registered, started with an `emit` bound to the queue, and stopped
  with the proxy, so a rollout does not leave a watch running. ([validated by starts every registered input](libs/shared/src/outbound/project/events/event-proxy.test.ts#L207), [stops every registered input on stop](libs/shared/src/outbound/project/events/event-proxy.test.ts#L232))
- `stop` drains what is queued and returns what it could not deliver, bounded by
  a deadline so a wedged sink cannot hold a rollout open. The queue is in memory
  and dies with the process — it is survivable only because everything on it is
  deduped and re-derivable, and it is NOT a durable outbox. ([validated by drains what is queued](libs/shared/src/outbound/project/events/event-proxy.test.ts#L253), [gives up at the deadline](libs/shared/src/outbound/project/events/event-proxy.test.ts#L266))
- The proxy resolves through the same `EVENT_ROUTER_URL` gate as the reporter it
  wraps, and never resolves the local pool when a router is configured — a
  pool-less process must be able to hold one. In local mode the event sink is
  the pool-backed reporter with a single attempt, since a failed same-process
  Postgres insert is not a wire blip. ([validated by never resolves the local queue when a router is configured, so a pool-less process can hold one](libs/shared/src/outbound/project/events/select-event-reporter.test.ts#L132), [presents a token thunk per call, so a rotated per-agent credential is picked up](libs/shared/src/outbound/project/events/select-event-reporter.test.ts#L102))

## Amendment (2026-09-08): GitHub delivers to the router; the Floor route is gone

Step 2 of the cutover ran the other way round from the order this ADR first
wrote down, and that is why it could be done in one change.

- The canonical repo-hook URL is the router's front door: `LORE_WEBHOOK_URL`
  on lore-api resolves to `https://<lore_event_router_hostname>/api/events`,
  and that is what `ensureLoreWebhook` installs and `classifyWebhook` reports
  against. The Floor's `POST /api/webhook/github` route, its `LORE_WEBHOOK_SECRET`
  and the `lore-floor-webhook-secret` ExternalSecret are deleted.
- The legacy URL is not. Every repo onboarded before this carries
  `https://<lore_webhook_hostname>/api/webhook/github`, and GitHub does not
  redeliver what 404s — so the Floor-host ingress keeps an Exact-match rule
  for that path that rewrites it to `/api/events` on the router, through an
  ExternalName Service (an Ingress can only name a Service in its own
  namespace). The alias lives in nginx rather than as a second route on the
  router so the router keeps exactly one endpoint, which is the property this
  ADR exists for. Because the alias is infrastructure, it applies BEFORE the
  route deletion deploys: traffic moves while both doors still stand, and the
  deletion has no window.
- lore-api treats a hook at either path as Lore's (`LORE_HOOK_PATHS`,
  `isLoreHook`). A legacy hook classifies `wrong_url` — repointable from the
  repo page or `POST /api/repos/:o/:r/webhook/ensure` — and `ensureRepoWebhook`
  PATCHes it in place. Before this, the match keyed on the Floor path alone, so
  a hook already at `/api/events` would have read as `missing` and the next
  ensure would have created a second hook delivering every event twice. The
  legacy path stays in the list for as long as any repo may still carry it;
  nothing forces the migration.
  ([validated by lists /api/events and the legacy /api/webhook/github as Lore hook paths](apps/lore-api/src/work/webhook/webhook-status.test.ts#L119), [updates a hook already at /api/events in place instead of creating a second one](apps/lore-api/src/work/webhook/webhook-manage.test.ts#L55), [returns wrong_url when a legacy hook at lore-webhook.gcp.re-cinq.com/api/webhook/github is still installed](apps/lore-api/src/work/webhook/webhook-status.test.ts#L50))
- `lore_webhook_hostname` and the Floor's `/api/webhook` ingress stay: the
  `/api/webhook/ci-ingest` and `/api/webhook/ci-tests` doors ride that prefix,
  and consumer repos' Actions variable `vars.LORE_WEBHOOK_URL` — a different
  variable that happens to share the name — is that host.

## Amendment (2026-09-09): the Floor consumes reported state; a cluster read is routed by claimant

The 2026-08-26 amendment made dispatch pull-only because a satellite is
unreachable for inbound calls, and left reporting untouched because every
cluster-agent already reports terminal phases inward. It said nothing about
the Floor's remaining habit of going to look: `HttpAgentApi`,
`HttpPodLogSource` and `HttpTokenCleanup` are all built on the one configured
`CLUSTER_AGENT_URL`, which is the central cluster-agent, and a read there
answers for a satellite-claimed run with a null that means "not here" and
reads as "produced nothing" (#1627). Each such site had been guarded case by
case (`agentCrVisible`, the reaper's visibility arm) rather than closed.

### Decision

Cluster state reaches the Floor as REPORTED state — the terminal event's
inline status, the `pipeline.station_runs` row, the stored pod-log chunks —
and a direct read of a cluster is the exception, taken only for a run this
Floor can see: a row claimed by the central cluster-agent, or a legacy
`running` row with no claimant. The rule per read site:

| Read | Survives? | Routed how |
| --- | --- | --- |
| Terminal status of a node CR (live event door) | Only as the fallback for an event that carries no `status` | Visible rows only; an event for a node with NO open row is dropped without any read — the node was already settled and a fabricated status would re-settle it |
| Terminal status of a node CR (reaper resolve / requeue arm) | Yes, until #1592 stores the reported terminal phase beside the output | Visible rows only, as before |
| Live pod logs for a node (`GET /api/agent-logs/{name}`) | Yes, for what a live read is worth | Visible rows only; a satellite run is served from the stored-chunk archive, which is the one source that reaches it |
| "Is this task's Agent still alive" (`isTaskAgentActive`) | Only for rounds that predate station runs | A round with a station-run row answers from that row's open/closed state; the CR probe is the legacy path and no satellite run can reach it |
| List + prune CRs (`agent-reconcile`) | Yes | Central-only maintenance by design: it enumerates the namespace the central agent owns, and every cluster-agent prunes its own (the prune loop already runs there, #1651) |

Writes follow the same line. The per-task token reclaim (`DELETE
/api/cluster/per-task-tokens/{taskId}`) is sent to central only when central
claimed any of the task's station runs, or when the task has no station run
at all; a task every run of which a satellite claimed is skipped with one log
line, since the DELETE would reach a cluster that never provisioned the token.
Reclaiming a satellite's token is the satellite's job, and under pull-only the
channel for telling it so is the claim round-trip — recorded as #1988, not
done here.

### Consequences

- The central cluster is one claimant among others on every per-run path; the
  only central-specific code left is the visibility test, whose input is the
  central cluster-agent's registry id — which the live event door now receives
  from production wiring, where it used to receive nothing and treat even a
  central-claimed row as unreadable. The pod-log route and the token reclaim
  take the same test. ([validated by `agent-logs.test.ts:143`](../apps/floor/src/transport/http/routes/agent-logs.test.ts#L143), [`agent-logs.test.ts:154`](../apps/floor/src/transport/http/routes/agent-logs.test.ts#L154), [`per-task-token.test.ts:27`](../apps/floor/src/work/watcher/per-task-token.test.ts#L27))
- A duplicate terminal delivery for an already-settled node is dropped rather
  than re-read; the walk advances on the first delivery and the second has
  nothing to add. ([validated by `node-event-handler.test.ts:417`](../apps/floor/src/work/assembly-run/node-event-handler.test.ts#L417))
- The remaining central reads are enumerated above, and a new read of a
  cluster from the Floor is a design change to this table rather than a local
  decision.

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
