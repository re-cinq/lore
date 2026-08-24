# Feature Specification: Station Consolidation

| Field   | Value                                                                 |
|---------|-----------------------------------------------------------------------|
| Feature | Station consolidation — one folder, one registry, declared triggers    |
| Status  | In Progress                                                                 |
| Created | 2026-08-24                                                            |
| Owner   | Platform Engineering                                                  |
| ADR     | [`ADR-024`](../../adrs/ADR-024-ubiquitous-language-execution-model.md) (station forms), [`ADR-044`](../../adrs/ADR-044-event-router-owns-the-event-bus.md) (event deliveries) |

Gathers every station in the factory into one source folder behind one
exhaustiveness-checked registry, and turns a station from something the Floor
*pulls* into something that *declares what it reacts to*. Along the way it fixes
the three defects that shape caused: work polled from the database that the event
bus already reported, six name registries that cannot drift-check each other, and
a bus that structurally cannot fan one event out to two consumers.

## Problem Statement

"Station" names three unrelated things in three homes. `apps/lore-station` is a
one-shot pod per assembly-line node, keyed by node type, contract
`(input, env) => NodeResult`. `apps/stations` is a long-lived HTTP service keyed
by URL segment, contract `() => Promise<string>`. `apps/lore-api`'s maintenance
route is a third registry with a signature byte-identical to the second. A fourth
home is unlabelled: the `feature_review` human station's server side lives in 601
lines of feature routes.

A station name must be spelled identically in six places — those three
registries, the `NodeType` enum, the `stations:` block of `scripts/task-types.yaml`,
and the generated `catalog-seed.yaml` — with no cross-check between any two. A
node type with no runner reaches a pod and dies at runtime with `unknown station
type`.

Because the Floor owns every trigger, work that an event already reported gets
polled for instead: the approval sweep asks the database every 60 seconds whether
a human has clicked a label, while `github.issues.labeled` sits on the bus being
discarded by a handler that early-returns on any label but its own. And because
`pipeline.events` is a work queue — one row per event, claimed `FOR UPDATE SKIP
LOCKED` — exactly one consumer ever sees a given event, so "let a station
subscribe" has no expressible meaning on the current substrate.

## Functional Requirements

- **FR1 — one folder, one registry.** Every station's source lives under
  `apps/stations/src/stations/<name>/`, one folder per station, holding its
  manifest, its handler, and its colocated tests. A single barrel exports
  `Record<StationName, StationModule>`, replacing the three hand-maintained
  registries. The folder name is the station name is the registry key is the URL
  segment — one string, not four.
  ([validated by registers every station folder, so adding one and forgetting the barrel fails here](apps/stations/src/stations/registry.test.ts#L25), [`index.test.ts:29`](apps/stations/src/stations/registry.test.ts#L29), [`index.test.ts:33`](apps/stations/src/stations/registry.test.ts#L33))

- **FR2 — a station declares its triggers.** Each station's manifest names how
  work reaches it, covering all five classes in one declaration: an
  assembly-line `node` (with its runtime, clone requirement, producible outcomes
  and timeout), a `human` station (with the route its worker acts on), an `event`
  subscription (by event name), a `cron` schedule, and a synchronous `http` call.
  A station may declare several. The manifest is the single source for the
  clone-requiring node types and the cron emitter set, which are duplicated
  today.
  ([validated by declares at least one trigger per station, so none is unreachable](apps/stations/src/stations/registry.test.ts#L41), [`index.test.ts:94`](apps/stations/src/stations/registry.test.ts#L94), [`index.test.ts:105`](apps/stations/src/stations/registry.test.ts#L105), [`index.test.ts:115`](apps/stations/src/stations/registry.test.ts#L115))

- **FR3 — the contract discriminates rather than merges.** A node station keeps
  `(input, env) => Promise<NodeResult>` and a sweep station keeps
  `() => Promise<string>`; the union pairs each manifest shape with its matching
  handler shape, so a folder declaring a cron trigger cannot export a node
  runner. Neither existing signature changes, so every moved station moves
  without an edit.
  ([validated by pairs a node manifest with a node runner, never a sweep's](apps/stations/src/stations/registry.test.ts#L83))

- **FR4 — drift is a compile error, not a runtime death.** The registry's
  `Record<StationName, StationModule>` makes a missing module fail typechecking;
  a type-level assertion binds the `NodeType` enum to the set of manifests
  declaring node triggers, so a node type with no runner cannot reach a pod; and
  a discovery test asserts the folder listing equals the barrel, that no two
  manifests claim the same name or node type, and that every declared cron
  schedule parses.
  ([validated by has a station for every dispatchable node type, so none dies at runtime](apps/stations/src/stations/registry.test.ts#L57), [`index.test.ts:67`](apps/stations/src/stations/registry.test.ts#L67), [`index.test.ts:75`](apps/stations/src/stations/registry.test.ts#L75), [`node-station-lookup.test.ts:11`](apps/stations/src/stations/node-station-lookup.test.ts#L11), [`node-station-lookup.test.ts:15`](apps/stations/src/stations/node-station-lookup.test.ts#L15), [`node-station-lookup.test.ts:21`](apps/stations/src/stations/node-station-lookup.test.ts#L21), [`node-station-lookup.test.ts:25`](apps/stations/src/stations/node-station-lookup.test.ts#L25))

- **FR5 — untrusted execution decides what may pool, not credentials.** A
  station that executes code or reads content it did not author runs in its own
  pod, never in the pooled service that holds the GitHub App private key, the
  database password and the org's model credential. This covers validation (which
  runs the target repo's own lint and typecheck commands), ingest (which reads a
  cloned working tree and alone holds graph-store egress), and comment triage
  (which feeds human-authored text to a model). Deterministic work over data the
  platform itself produced may pool.

- **FR6 — an event is delivered per subscriber.** Each subscribed consumer gets
  its own delivery row for an event, claimed and retried independently, so two
  consumers can react to one event and neither can starve or steal from the
  other. A consumer that was offline drains its own backlog when it returns
  rather than missing what happened while it was down. An event is never collected while a
  subscriber is still owed a delivery of it. A name held back at claim time —
  a busy serial family — leaves its rows pending rather than parked in flight.
  ([validated by delivers one event to every subscriber that asked for it](libs/shared/src/project/events/event-deliveries.contract.test.ts#L72), [`event-deliveries.contract.test.ts:84`](libs/shared/src/project/events/event-deliveries.contract.test.ts#L84), [`event-deliveries.contract.test.ts:97`](libs/shared/src/project/events/event-deliveries.contract.test.ts#L97), [`event-deliveries.contract.test.ts:123`](libs/shared/src/project/events/event-deliveries.contract.test.ts#L123), [`event-deliveries.contract.test.ts:134`](libs/shared/src/project/events/event-deliveries.contract.test.ts#L134), [`event-deliveries.contract.test.ts:144`](libs/shared/src/project/events/event-deliveries.contract.test.ts#L144), [`event-deliveries.contract.test.ts:159`](libs/shared/src/project/events/event-deliveries.contract.test.ts#L159), [`event-deliveries.contract.test.ts:173`](libs/shared/src/project/events/event-deliveries.contract.test.ts#L173), [`event-deliveries.contract.test.ts:228`](libs/shared/src/project/events/event-deliveries.contract.test.ts#L228), [`event-deliveries.contract.test.ts:56`](libs/shared/src/project/events/event-deliveries.contract.test.ts#L56), [`event-deliveries.contract.test.ts:239`](libs/shared/src/project/events/event-deliveries.contract.test.ts#L239))

- **FR7 — fan-out is single-sourced and reaches every writer.** The clause that
  creates delivery rows is defined once in TypeScript and composed into the same
  statement as each event insert, so an event is never visible without its
  deliveries — including from the writers that must insert an event and its
  owning row atomically and therefore cannot route through the event-router's
  HTTP front door. A deduplicated event insert produces no deliveries, because it
  produces no event. A test fails the build when an event-insert site neither
  lives in the shared writer nor composes the shared clause.
  ([validated by inserts one delivery per subscriber of the named event](libs/shared/src/project/events/fan-out.test.ts#L5), [`fan-out.test.ts:15`](libs/shared/src/project/events/fan-out.test.ts#L15), [`fan-out.test.ts:19`](libs/shared/src/project/events/fan-out.test.ts#L19), [`events-fan-out.test.ts:6`](libs/shared/src/events-fan-out.test.ts#L6), [`events-fan-out.test.ts:20`](libs/shared/src/events-fan-out.test.ts#L20), [`events-fan-out.test.ts:35`](libs/shared/src/events-fan-out.test.ts#L35), [`assembly-runs-fan-out.test.ts:13`](libs/shared/src/project/assembly-runs/assembly-runs-fan-out.test.ts#L13), [`assembly-runs-fan-out.test.ts:26`](libs/shared/src/project/assembly-runs/assembly-runs-fan-out.test.ts#L26), [`fan-out-writers.test.ts:49`](libs/shared/src/project/events/fan-out-writers.test.ts#L49), [`fan-out-writers.test.ts:53`](libs/shared/src/project/events/fan-out-writers.test.ts#L53))

- **FR8 — a subscriber registers before it drains.** Each process upserts its
  subscription set at startup and fails to start if that upsert fails. An event
  whose name no subscriber has claimed produces no deliveries, which is silent
  where the previous behaviour was a loud dead-letter, so it is reported: a query
  surfaces recent events with zero deliveries, and a boot-time reconcile creates
  missing deliveries for events younger than the prune horizon. Giving up on a
  delivery is reported the same way and for the same reason: dead-lettering
  wrote the row and said nothing, so work the bus had abandoned left no trace
  before the prune deleted it a week later.
  ([validated by delivers nothing for an event nobody subscribed to](libs/shared/src/project/events/event-deliveries.contract.test.ts#L113), [`event-deliveries.contract.test.ts:187`](libs/shared/src/project/events/event-deliveries.contract.test.ts#L187), [`event-deliveries.contract.test.ts:256`](libs/shared/src/project/events/event-deliveries.contract.test.ts#L256), [`cron.test.ts:129`](apps/floor/src/jobs/cron.test.ts#L129), [`cron.test.ts:143`](apps/floor/src/jobs/cron.test.ts#L143), [`cron.test.ts:151`](apps/floor/src/jobs/cron.test.ts#L151), [`loop.test.ts:286`](apps/floor/src/main-loop/loop.test.ts#L286), [`loop.test.ts:303`](apps/floor/src/main-loop/loop.test.ts#L303), [`loop.test.ts:316`](apps/floor/src/main-loop/loop.test.ts#L316))

- **FR9 — a delivery carries its own deadline.** The visibility timeout is
  stamped per delivery from the subscribing station's declared timeout rather
  than fixed globally, so a handler is presumed dead at the budget it declared.
  Under a single global ten-minute timeout, a longer handler is re-queued while
  still running and executes concurrently with itself until its attempts are
  exhausted.
  ([validated by stamps the subscriber's declared timeout on the delivery](libs/shared/src/project/events/event-deliveries.contract.test.ts#L198), [`event-deliveries.contract.test.ts:210`](libs/shared/src/project/events/event-deliveries.contract.test.ts#L210))

- **FR10 — a pooled node reports through the path a person already uses.** A
  node dispatched to the pooled service reports its outcome over the same resume
  channel a human station reports through, converging on the same terminal
  handling as a pod. That channel carries the whole node result — its extras,
  failure class and usage — not the outcome alone, because downstream routing
  reads those fields; a human station, which produces only a decision, still
  reports the bare outcome. The result is validated on arrival rather than cast,
  since it crosses a process boundary as JSON, and a malformed one fails the
  event instead of advancing the walk on something nothing can route.
  Reactions to a node finishing run for EVERY door — the pod's terminal event,
  the reaper's resolve, and a resumed report — rather than for whichever one
  happened to call them, and a reaction that throws never stops the walk.
  ([validated by accepts an outcome on its own, which is all a human station reports](libs/assembly-lines/src/node-result-schema.test.ts#L11), [`node-result-schema.test.ts:17`](libs/assembly-lines/src/node-result-schema.test.ts#L17), [`node-result-schema.test.ts:26`](libs/assembly-lines/src/node-result-schema.test.ts#L26), [`node-result-schema.test.ts:39`](libs/assembly-lines/src/node-result-schema.test.ts#L39), [`node-result-schema.test.ts:43`](libs/assembly-lines/src/node-result-schema.test.ts#L43), [`node-result-schema.test.ts:49`](libs/assembly-lines/src/node-result-schema.test.ts#L49), [`node-result-schema.test.ts:57`](libs/assembly-lines/src/node-result-schema.test.ts#L57), [`node-result-schema.test.ts:71`](libs/assembly-lines/src/node-result-schema.test.ts#L71), [`resume-event-handler.test.ts:118`](apps/floor/src/jobs/assembly-run/resume-event-handler.test.ts#L118), [`resume-event-handler.test.ts:135`](apps/floor/src/jobs/assembly-run/resume-event-handler.test.ts#L135), [`resume-event-handler.test.ts:156`](apps/floor/src/jobs/assembly-run/resume-event-handler.test.ts#L156), [`resume-event-handler.test.ts:164`](apps/floor/src/jobs/assembly-run/resume-event-handler.test.ts#L164), [`advance.test.ts:1096`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1096), [`advance.test.ts:1125`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1125), [`advance.test.ts:1152`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1152), [`advance.test.ts:1191`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1191), [`advance.test.ts:1215`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1229), [`run-node.test.ts:34`](apps/stations/src/kernel/run-node.test.ts#L34), [`run-node.test.ts:48`](apps/stations/src/kernel/run-node.test.ts#L48), [`run-node.test.ts:68`](apps/stations/src/kernel/run-node.test.ts#L68), [`run-node.test.ts:81`](apps/stations/src/kernel/run-node.test.ts#L81))

- **FR11 — detection is short units, not one long one.** No detection work runs
  as a long-lived unit or requires a pod for a deadline. The three detectors that
  make no model calls run as ordinary subscribed handlers, one per repository per
  tick. The one that judges statements with a model is sharded to the unit its
  own code already produces — one specification per unit, each opening its own
  pull request — so a failure costs one specification rather than a whole
  repository pass, and an explicit per-repository cap replaces the rate limit
  that the old deadline was accidentally providing.

- **FR12 — a merged pull request walks an assembly line.** The work that follows
  a merge is a line of recorded steps rather than one function behind swallowing
  error handlers, so each step's outcome is persisted and visible. Every step
  except the status settle routes both its success and its failure forward to the
  next step: a failing step is recorded and the line continues, because the steps
  do not depend on each other's results. Only the settle is a genuine
  precondition and only its failure ends the line. The line starts from the
  pull-request webhook, keyed by subject so a redelivery cannot double-run it,
  and the periodic sweep becomes a reconciler for merges whose webhook was lost.

- **FR13 — a model call is an agent node.** Stations receive one credential and
  it is not a model credential; the agent node is the seam that carries model
  auth and streams its own cost accounting. So every model call in the factory
  runs on an agent node, and no station — pooled or pod — makes one. A station
  that needs a judgement starts a line whose judging step is an agent node.

- **FR14 — curation is a node, not a tail.** Extracting a lesson from a finished
  task is a step of its own, reached by the same event from every caller that
  finishes work, rather than an inline call appended to whoever noticed. The
  episode itself is written by the caller and carries no model call. As a
  consequence the pooled service holds no model credential at all, and a
  curation that fails is retried and visible instead of swallowed.

- **FR15 — a subscriber that holds no pool consumes over HTTP.** Registration,
  claim, ack, fail, dead-letter, reap and the orphan report are all reachable
  from a process with no database, carrying the subscriber's declared timeout
  across the wire, and every one of them requires the same bearer token the rest
  of the service-to-service surface does. The client and the routes are two
  halves of one contract written apart, so they are exercised against each other
  rather than each against its own idea of the other.
  ([validated by registers a subscription and claims back the event it asked for](apps/event-router/src/delivery/routes/event-deliveries-roundtrip.test.ts#L50), [`event-deliveries-roundtrip.test.ts:63`](apps/event-router/src/delivery/routes/event-deliveries-roundtrip.test.ts#L63), [`event-deliveries-roundtrip.test.ts:74`](apps/event-router/src/delivery/routes/event-deliveries-roundtrip.test.ts#L74), [`event-deliveries-roundtrip.test.ts:87`](apps/event-router/src/delivery/routes/event-deliveries-roundtrip.test.ts#L87), [`event-deliveries-roundtrip.test.ts:100`](apps/event-router/src/delivery/routes/event-deliveries-roundtrip.test.ts#L100), [`event-deliveries-roundtrip.test.ts:111`](apps/event-router/src/delivery/routes/event-deliveries-roundtrip.test.ts#L111), [`event-deliveries-roundtrip.test.ts:122`](apps/event-router/src/delivery/routes/event-deliveries-roundtrip.test.ts#L122), [`event-deliveries-roundtrip.test.ts:130`](apps/event-router/src/delivery/routes/event-deliveries-roundtrip.test.ts#L130))

- **FR16 — a delivery's identity is not its event's.** Acknowledging, failing and
  dead-lettering address the delivery, while a handler citing the event — one
  handing a large payload onward by reference — is given the event's own id. A
  consumer handed the delivery's id where the event's was meant would read the
  wrong row, or none.
  ([validated by passes the EVENT id as meta, not the delivery's, so a by-reference payload resolves](apps/floor/src/main-loop/loop.test.ts#L111))

- **FR17 — a station is given its data, never resolves it.** A station that needs
  a database or a code host receives those ports from whichever process hosts it,
  rather than importing that process's singletons. This is what lets one registry
  hold every station: the package is shared with a pod that has no pool, so a
  station reaching for one could not live in it — and a consequence is that the
  sweeps become testable without a database at all. The URL surface is DERIVED
  from the manifests rather than hand-listed, so what a station declares and what
  the service answers to cannot disagree. A station DECLARES the ports it reaches
  for, and a host exposes only what it can actually serve — so a process without
  a code host does not advertise a repo sweep it could only fail, and a port a
  host does not serve fails by name rather than as an undefined call.
  ([validated by reports nothing to do when no task is waiting](apps/stations/src/stations/approval-check/approval-check.test.ts#L52), [`approval-check.test.ts:58`](apps/stations/src/stations/approval-check/approval-check.test.ts#L58), [`approval-check.test.ts:66`](apps/stations/src/stations/approval-check/approval-check.test.ts#L66), [`approval-check.test.ts:75`](apps/stations/src/stations/approval-check/approval-check.test.ts#L75), [`approval-check.test.ts:83`](apps/stations/src/stations/approval-check/approval-check.test.ts#L83), [`approval-check.test.ts:92`](apps/stations/src/stations/approval-check/approval-check.test.ts#L92), [`service-stations.test.ts:17`](apps/stations/src/kernel/service-stations.test.ts#L17), [`service-stations.test.ts:29`](apps/stations/src/kernel/service-stations.test.ts#L29), [`service-stations.test.ts:39`](apps/stations/src/kernel/service-stations.test.ts#L39), [`service-stations.test.ts:45`](apps/stations/src/kernel/service-stations.test.ts#L45), [`station.test.ts:11`](apps/stations/src/stations/lib/station.test.ts#L11), [`station.test.ts:15`](apps/stations/src/stations/lib/station.test.ts#L15), [`maintenance.test.ts:80`](apps/lore-api/src/api/routes/maintenance/maintenance.test.ts#L80), [`maintenance.test.ts:90`](apps/lore-api/src/api/routes/maintenance/maintenance.test.ts#L90))

- **FR18 — a finished run records what it did.** Reaching the exit writes the
  run's episode. This was the terminal station's job and it never ran: every
  blueprint names that station as its EXIT, and the walk finishes AT the exit
  rather than dispatching it, so no assembly run has ever written one. Recording
  is telemetry, so a failure to record never decides whether the run closes.
  ([validated by writes the run's episode when the line reaches its exit](apps/floor/src/jobs/assembly-run/advance.test.ts#L1247), [`advance.test.ts:1271`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1271), [`advance.test.ts:1295`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1295))

- **FR19 — a station that calls a model is given a credential, and says so when
  it cannot.** A station's recipe declares whether it needs the model credential,
  and only those that do receive one — a key a deterministic station never uses is
  surface for nothing. A station that cannot reach a model reports a FAILED node
  naming the cause, rather than a plausible default. Comment triage did the
  opposite on both counts: its pod carried no model credential and the image ships
  no CLI to fall back to, so every classification failed, was swallowed into
  `ignore`, and reported SUCCESS — silently dropping every human PR comment and
  telling the walk it was handled.
  ([validated by declares the LLM secret for a station whose recipe says it needs one](apps/floor/src/jobs/agent/agent-catalog.test.ts#L420), [`comment-triage.test.ts:73`](apps/stations/src/stations/comment-triage/comment-triage.test.ts#L73), [`comment-triage.test.ts:90`](apps/stations/src/stations/comment-triage/comment-triage.test.ts#L90), [`comment-triage.test.ts:71`](libs/shared/src/review/comment-triage.test.ts#L71))

## Non-goals

- **Merging the pod runtime away.** Three station types must stay pods (FR5) and
  agent nodes are pods by definition. The consolidation is of *source and
  registry*, not of every runtime; the pod entrypoint survives as a thin shim
  built from the same tree.
- **Parallel assembly-line nodes.** The walk selects a single edge per outcome.
  FR12 works within that constraint by routing failures forward, and does not
  add fan-out to the graph engine.
- **A general pub/sub bus.** Delivery rows serve declared subscribers of named
  events. Nothing here adds topics, wildcards, or ordering guarantees the queue
  did not already provide.
- **Re-homing the Floor's remaining powers.** Cluster authority, the walk, and
  the scheduler stay where they are.

## Acceptance Criteria

- Adding a station is a folder and a barrel line; omitting either fails the
  build rather than a pod.
- No station process holds a model credential, and removing it from the pooled
  service's environment breaks nothing.
- Stopping a subscriber, generating events, and restarting it results in every
  event being handled exactly once, late.
- A step failing inside the merge line leaves every later step still executed and
  recorded.
- No detection unit runs longer than its declared timeout, and none requires a
  dedicated pod to obtain one.
- The approval path reacts to the labelling event, with the periodic sweep
  retained only as a reconciler and observably not the thing that did the work.

## Open Questions

- Whether comment triage is presently able to make its model call at all: it is a
  station node, station recipes carry no model credential, and the no-key path
  falls back to a command-line client the station image does not ship. This must
  be verified against the deployed recipe before the migration, since the answer
  changes what the review line is actually doing today.
- Whether the periodic reconcilers should remain per-minute once their events are
  subscribed, or drop to a slower cadence appropriate to catching lost webhook
  deliveries rather than to being the primary path.
