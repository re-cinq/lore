---
adr_number: 37
title: "SSE for assembly-line run observability"
status: accepted
date: 2026-07-17
domains: [architecture, observability, floor, web-ui]
---

# ADR-037: SSE for assembly-line run observability

This ADR adopts Server-Sent Events as the transport for live assembly-line run observability — the stack's first streaming transport — carried by an in-process pub/sub that is sound only under the Floor's pinned single replica, with PG LISTEN/NOTIFY named as the multi-replica escape hatch behind an unchanged subscribe API.

## Context

The ai-agent-subsystem supervisor POSTs the full claude stream-json run output to
the Floor as NDJSON at `POST /api/agent-events`. The Floor's mapper
(`apps/floor/src/jobs/agent/agent-events.ts`) keeps only the terminal `result`
line as a `pipeline.llm_calls` cost row. `specs/assembly-line-run-viz/spec.md`
specifies projecting the rest into `pipeline.agent_run_events` and rendering a
run live.

**The stream is not currently thrown away, and this ADR does not claim it is.**
The route `apps/floor/src/delivery/http/routes/agent-events.ts` already calls
`archiveAgentEvents(body, key)` in a fire-and-forget `archiveRaw` helper, writing
the raw redacted NDJSON to GCS. The bucket is configured via
`LORE_AGENT_EVENTS_BUCKET` (the task-logs bucket, whose `log_retention_days`
lifecycle prunes the objects); before that env var was set the archive was a
silent no-op. Any claim that this feature rescues discarded
data is false; it adds a queryable, cursored projection alongside an existing
write-only archive. The Alternatives section below answers "why not just read the
archive?" directly, because an ADR that enshrined the wrong premise would
mislead every later reader.

> **Amendment (2026-08-11, #1148).** The GCS archive described above is retired.
> `pipeline.agent_run_turns` (`specs/turn-level-transcript-store`) now holds the
> full redacted stream — keyed by run, correlated to assembly-line nodes, 30-day
> retention, readable at `GET /api/agent-turns/{assemblyLineId}` — which is
> strictly stronger than the archive on every axis the Alternatives section used
> to reject reading it. The sink's durable outputs are the three Postgres row
> families; existing `__agent_events__/` objects age out via the bucket's
> lifecycle rule.

Two constraints shape the decision:

**The Floor is pinned to one replica, and that pin is an admitted limitation
rather than a chosen architecture.**
`infra/terraform/modules/gke-mcp/lore-platform/charts/floor-helm/values.yaml`
sets `replicaCount: 1` and comments, in full: "Agent is a singleton (job
processors don't tolerate two writers claiming the same task). Use a PDB to block
Autopilot from evicting without warning, but keep replicas at 1 — HA at the agent
layer requires lease coordination that doesn't exist yet." The chart also sets
`podDisruptionBudget.minAvailable: 1`. Reading that comment as an endorsement of
single-replica design would be a misreading; it is scheduled debt, and this ADR
treats it as such.

**Nothing in the stack streams today.** A search of `apps/floor/src`,
`apps/web-ui/src`, and `libs` for `text/event-stream`, `new WebSocket`, and
`new EventSource` returns zero hits; every live view is a 4–15 second
`setInterval` poll. One false positive is worth naming so a later reader's grep
does not conclude otherwise: `apps/floor/src/main-loop/event-names.ts:13` exports
`type EventSource`, which is the event bus's source union (`github` / `cron` /
`internal` / `kubernetes`) and has nothing to do with the browser API. Types
introduced for this feature must not collide with that name.

## Decision

Run observability is delivered over Server-Sent Events at
`GET /api/agent-events/stream/{assemblyLineId}`, with catch-up-then-live
semantics keyed on a row-id cursor. ([validated by `agent-events-stream.test.ts:511`](apps/floor/src/delivery/http/routes/agent-events-stream.test.ts#L512), [`agent-events-stream.test.ts:167`](apps/floor/src/delivery/http/routes/agent-events-stream.test.ts#L168), [`agent-events-stream.test.ts:238`](apps/floor/src/delivery/http/routes/agent-events-stream.test.ts#L239))

The POST handler and the SSE subscribers are joined by an in-process pub/sub. ([validated by `agent-event-bus.test.ts:28`](apps/floor/src/jobs/agent/agent-event-bus.test.ts#L29)) A
subscriber registers against an assembly-line id; the ingest path publishes each
projected row to matching subscribers after the write commits. ([validated by `agent-event-bus.test.ts:41`](apps/floor/src/jobs/agent/agent-event-bus.test.ts#L42))

Reconnection is lossless by construction rather than by buffering: the browser
resends `Last-Event-ID`, and the server replays from the database before
attaching to the live tail. ([validated by `agent-events-stream.test.ts:286`](apps/floor/src/delivery/http/routes/agent-events-stream.test.ts#L287), [`run-event-reducer.test.ts:224`](apps/web-ui/src/lib/run-event-reducer.test.ts#L225)) The bus is therefore best-effort and holds no
backlog — durability lives in `pipeline.agent_run_events`, not in memory. ([validated by `agent-event-bus.test.ts:159`](apps/floor/src/jobs/agent/agent-event-bus.test.ts#L160))

A subscriber that cannot keep up is disconnected rather than allowed to apply
back-pressure to the ingest path, which shares a process with the cost sink and
the Floor's job loops. ([validated by `agent-event-bus.test.ts:187`](apps/floor/src/jobs/agent/agent-event-bus.test.ts#L188), [`agent-events-stream.test.ts:419`](apps/floor/src/delivery/http/routes/agent-events-stream.test.ts#L420))

Both hops set `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. ([validated by `agent-events-stream.test.ts:511`](apps/floor/src/delivery/http/routes/agent-events-stream.test.ts#L512), [`route.test.ts:149`](apps/web-ui/src/app/api/assembly-runs/[id]/events/stream/route.test.ts#L149))

The `AgentRunEventRow` type is canonical in `libs/shared` and hand-mirrored in
`apps/web-ui`, with a type-only drift guard under `scripts/type-drift/`. ([validated by `run-stream-types.test.ts:26`](apps/web-ui/src/lib/run-stream-types.test.ts#L27), [`run-stream-types.test.ts:66`](apps/web-ui/src/lib/run-stream-types.test.ts#L67))

The definition DAG is laid out and rendered by hand in SVG, with no new
dependency. ([validated by `dag-layout.test.ts:45`](apps/web-ui/src/lib/dag-layout.test.ts#L45), [`dag-layout.test.ts:147`](apps/web-ui/src/lib/dag-layout.test.ts#L147))

## Consequences

The in-process bus is sound only while the Floor runs exactly one replica. A
second replica would silently serve a subscriber from a process that never sees
the other's writes, and the failure would look like a stalled UI rather than an
error. This is a real coupling to the `replicaCount: 1` pin, and it is recorded
here so that whoever lifts that pin — the same lease-coordination work the
chart's comment defers — finds this ADR rather than discovering the coupling in
production.

The migration path is deliberately narrow: the bus's internals swap to PG
LISTEN/NOTIFY behind the same subscribe API, and no route, handler, or client
changes. Because the cursor and the durability already live in the table, a
NOTIFY payload need only carry a row id.

SSE costs one held HTTP connection per viewer. The Floor is not a
high-concurrency front end, and the audience for a run page is small; the
disconnect-slow-clients rule bounds the blast radius. Should held connections
ever become the constraint, the same cursor supports falling back to polling
`GET /api/agent-events/{assemblyLineId}` with no contract change.

Polling remains the correct pattern for every non-streaming view; this decision
introduces streaming for run observability only, and is not a licence to convert
existing polled views.

**Amendment 2026-08-14 — telemetry correlates on an id, not on a name.** Rows
were attributed to a node by matching `agent_cr_name`, a string assembled from a
12-hex prefix of the run id plus the node id and iteration, resolved through a
`LEFT JOIN LATERAL` whose tie-break was "newest matching node row wins". That is
a guess wearing a join's clothing: two runs colliding on their id prefix
attribute one's tool calls to the other, silently, and the relationship cannot be
expressed as a foreign key even in principle. A StationRun now carries a
`station_run_id` (ADR-024 amendment), the Floor puts it on the CR's labels
because it is the party that named the CR, and `agent_run_events` /
`agent_run_turns` / `llm_calls` key on it. The CR name survives as a Kubernetes
resource name and stops being an identity. The pod is deliberately NOT required
to echo the id back: the Floor already knows it at write time, so the correlation
improves without a change in the external ai-agent-subsystem repo.

**Amendment 2026-08-17 — the producer STATES the identity; the join is the fallback.** Amendment 2 above concluded that the pod need not echo the id back, "because the Floor already knows it at write time". That is the part that does not hold: the Floor does not know it, it *infers* it, from the same `agent_cr_name` lateral whose tie-break Amendment 2 called a guess wearing a join's clothing. Stamping `station_run_id` onto the CR moved which id the guess produces, not whether it is a guess. The concrete cost is an invariant no write path can enforce — nothing may ever copy a node row with its `agent_cr_name` intact, or the copy silently steals the original's late-arriving cost and telemetry rows; fork-and-rerun hit exactly that and had to null the column on copy, and every future feature touching node rows has to remember the same rule unaided. So the event carries the identity: `source.assembly_run` / `node` / `iteration` / `station_run`, declared in ONE place (`libs/shared/.../run-identity/carried-run-identity.ts`) because it crosses a process boundary into an externally-built image. A stated identity is authoritative and is taken WHOLE — a per-column fallback would pair a stated run with an inferred node, a row wrong in a way no reader can detect — and the CR-name join is consulted only for events that state nothing. This half ships READERS-FIRST: every sink accepts the field before any producer emits it, so the ai-agent-subsystem change can land on its own schedule, and until it does every envelope parses to null and the join stays in charge. ([validated by reads the identity a producer stamped into the attribution](libs/shared/src/project/run-identity/carried-run-identity.test.ts#L12), [`carried-run-identity.test.ts:21`](libs/shared/src/project/run-identity/carried-run-identity.test.ts#L21), [`carried-run-identity.test.ts:31`](libs/shared/src/project/run-identity/carried-run-identity.test.ts#L31), [`carried-run-identity.test.ts:35`](libs/shared/src/project/run-identity/carried-run-identity.test.ts#L35), [`carried-run-identity.test.ts:46`](libs/shared/src/project/run-identity/carried-run-identity.test.ts#L51), [`carried-run-identity.test.ts:51`](libs/shared/src/project/run-identity/carried-run-identity.test.ts#L56), [`agent-run-events.test.ts:61`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L61), [`agent-run-events.test.ts:93`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L93), [`agent-run-events.test.ts:376`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L376), [`agent-run-events.test.ts:403`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L403), [`agent-run-turns.test.ts:63`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L63), [`agent-run-turns.test.ts:317`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L317), [`usage-memory.test.ts:49`](libs/shared/src/project/usage/usage-memory.test.ts#L49), [`usage-memory.test.ts:73`](libs/shared/src/project/usage/usage-memory.test.ts#L73), [`usage-pg.test.ts:78`](libs/shared/src/project/usage/usage-pg.test.ts#L78), [`usage-pg.test.ts:101`](libs/shared/src/project/usage/usage-pg.test.ts#L101), [`agent-run-turns.test.ts:29`](apps/floor/src/jobs/agent/agent-run-turns.test.ts#L31), [`agent-run-turns.test.ts:50`](apps/floor/src/jobs/agent/agent-run-turns.test.ts#L52); implemented by [`carried-run-identity.ts:51`](libs/shared/src/project/run-identity/carried-run-identity.ts#L51), [`agent-run-events-pg.ts:93`](libs/shared/src/project/agent-run-events/agent-run-events-pg.ts#L93), [`usage-pg.ts:33`](libs/shared/src/project/usage/usage-pg.ts#L33))

Cross-references: ADR-015 (webhook-driven review reactor) and its event-bus
amendment own Floor-internal triggering through `pipeline.events`; this ADR owns
browser transport and deliberately does not route through that bus, because a
durable at-least-once substrate is the wrong tool for a best-effort live tail
whose durability is the projection table. ADR-024 (ubiquitous language and
execution model) governs the naming used here.

## Alternatives

**Read the existing GCS raw-NDJSON archive instead of projecting a table.**
Rejected. The archive is keyed by ingest timestamp rather than by run, has no
cursor, and cannot be tailed — it
supports post-hoc replay of a blob, not a live view or a resumable stream.
Serving a run page from it would mean fetching and parsing whole NDJSON objects
per view. It remained valuable as a raw audit substrate until
`pipeline.agent_run_turns` subsumed that role, and was retired then (see the
amendment in Context, #1148).

**WebSocket.** Rejected. The traffic is unidirectional server-to-client; a
WebSocket buys a full duplex channel nothing needs, in exchange for a protocol
upgrade through the ingress, a heartbeat/reconnect state machine written by hand,
and a client library or hand-rolled equivalent. SSE gets automatic browser
reconnection and `Last-Event-ID` resumption for free, which is precisely the
catch-up-then-live semantic the spec requires. Native `EventSource` needs no
dependency.

**Polling, as every other live view does.** Rejected for this view specifically.
A per-tool-call transcript at a 4–15 second poll interval renders as jumps rather
than as a stream, and closing the interval enough to feel live turns each viewer
into a repeated whole-window query. The existing polled views stay polled.

**A third-party SSE or realtime library.** Rejected. SSE framing is a handful of
lines of text, `EventSource` is native, and this epic is explicitly zero-dep.

**A `node_status` event type published alongside the run events.** Rejected. Node
state already has a source of truth in `pipeline.station_runs`, which the
walk writes; a parallel status event would be a second source that drifts against
it. The client seeds from the table and derives running-versus-finished from the
per-node `init` and `result` events.

**An off-the-shelf graph layout library for the DAG.** Rejected. Every assembly
line definition in `libs/assembly-lines/src/assembly-lines/*.yaml` is at most 7
nodes today — `implementation.yaml` is the largest at exactly 7 (implement,
validate, push, review, address, retrospective, done), including an
`implement → implement` self-loop and the `validate → implement` and
`address → validate` back-edges, so the renderer must handle cycles but not
scale. At that size a hand-rolled layered SVG layout is smaller than the adapter
code a library would need. This is an observed bound, not one the layout
enforces; a definition substantially larger than that is the trigger to revisit,
and the fallback is a layout dependency confined to the renderer, not a change to
the transport or the contract.

**Sharing the `AgentRunEventRow` type by importing `libs/shared` into web-ui.**
Rejected because it is not possible. As `scripts/type-drift/feature-types.drift.ts`
records, `apps/web-ui` is excluded from the npm workspace and built in an isolated
Docker context, and `@re-cinq/lore-shared` drags in the Anthropic SDK, dgraph, and
tree-sitter. The established answer is a hand-mirror plus a type-only drift guard
that fails `tsc --noEmit` the moment the canonical type gains a key the mirror
lacks; this feature follows that pattern rather than inventing a second one.
