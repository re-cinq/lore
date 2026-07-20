# Feature Specification: Assembly Line Run Visualization

| Field   | Value                    |
|---------|--------------------------|
| Feature | Assembly Line Run Visualization |
| Status  | In Progress              |
| Owner   | Platform Engineering     |
| Builds on | [ADR-037](../../adrs/ADR-037-sse-run-observability.md), [ADR-015](../../adrs/ADR-015-webhook-driven-review-reactor.md) |

Assembly Line Run Visualization projects the claude stream-json output the ai-agent-subsystem already POSTs to the Floor into a queryable `pipeline.agent_run_events` table, streams it to the browser over Server-Sent Events with catch-up-then-live semantics, and renders a run as a live definition DAG with per-node transcripts, a file-attention heatmap, and a timeline.

**Status tripwire — read before adding a test link to this spec.** `lore/require-status-matches-coverage` is an ERROR and derives the required status from this document's own links: no link entitles it to `Draft`, one or more to `In Progress`, all of them to `Shipped`. The moment any implementing issue adds a single `([validated by …])` link below without flipping the `| Status |` row above, `eslint .` goes red repo-wide for everyone, not just for that PR. Flip the row in the same commit that adds the first link.

## Problem Statement

The ai-agent-subsystem supervisor POSTs the full claude stream-json run output to
the Floor as NDJSON at `POST /api/agent-events`, one line per envelope
`{"source": {task, agent, pod}, "event": <stream-json line>}`. The Floor's mapper
(`apps/floor/src/jobs/agent/agent-events.ts`) projects only the terminal `result`
line into a `pipeline.llm_calls` cost row and skips every other line silently.

The raw body is not discarded: the route
(`apps/floor/src/delivery/http/routes/agent-events.ts`) already calls
`archiveAgentEvents(rawNdjson, key)`, writing the redacted NDJSON to GCS
fire-and-forget. That archive is dormant until a bucket is configured, is keyed
by timestamp rather than by run, offers no cursor, and cannot be tailed live — so
it answers "what happened, eventually" and never "what is happening now". This
feature adds a queryable projection alongside that archive; it does not rescue
data that was being thrown away.

The observable result today is that a developer watching an assembly line has a
task row, a set of node rows, and a PR link — but no view of what the agent is
actually doing inside a node while it runs. Every live view in the product is a
4–15 second `setInterval` poll, which cannot render a per-tool-call stream at a
useful granularity.

## Goals & Non-Goals

- The first cut delivers persistence, live transport, history, and the run visualization behind session-authenticated web-ui proxies.
- There is deliberately no `node_status` event type; node state is seeded from `pipeline.assembly_line_nodes` and derived from per-node `init` / `result` events, because a second source of truth for node status would drift against the table the walk actually writes.
- The replay scrubber (`ReplayScrubberView`) is out of scope for the first cut and is specified by a later revision of this document.
- Retention of the pre-existing GCS raw-NDJSON archive is out of scope; this feature owns only the `pipeline.agent_run_events` prune.
- Cost accounting is unchanged in the sense that this feature introduces no new cost semantics, no new cost schema, and no change to which line produces a `pipeline.llm_calls` row.

## Functional Requirements

<!--
  One statement per behaviour; link its unit tests inline (v3):
  `Statement. ([validated by `file.test.ts:NN`](path#LNN))`.
  Adding the first link REQUIRES flipping the `| Status |` row to `In Progress`.
-->

### FR1 — Persistence

- FR1.1. Every stream-json line POSTed to `/api/agent-events` is projected into one `pipeline.agent_run_events` row, not only the terminal `result` line.

- FR1.1a. Rows are written in batches. An empty batch issues no query and returns no rows, and a non-empty batch is bound as a single parameter rather than interpolated into statement text, because `filePaths` and `payload` carry agent-controlled text. ([validated by `agent-run-events.test.ts:171`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L171), [`agent-run-events.test.ts:294`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L294), [`agent-run-events.test.ts:313`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L313))

- FR1.2. The canonical row contract is `AgentRunEventRow` with the fields `id` (a string-encoded bigint used as the stream cursor), `taskId`, `agentCrName`, `assemblyLineId`, `nodeId`, `iteration`, `eventType`, `toolName`, `toolUseId`, `isError`, `filePaths`, `summary`, `payload`, and `createdAt`. ([validated by `agent-run-events.test.ts:96`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L96), [`agent-run-events.test.ts:137`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L137))

- FR1.3. The `id` field crosses every wire boundary as a string and is never narrowed to a JavaScript number, because a bigint identity column exceeds `Number.MAX_SAFE_INTEGER`. ([validated by `agent-run-events.test.ts:84`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L84), [`agent-run-events.test.ts:249`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L249), [`agent-run-events.test.ts:336`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L336))

- FR1.4. The `eventType` field is one of `init`, `message`, `thinking`, `tool_call`, `tool_result`, or `result`.

- FR1.5. A line whose event type is not one of the six known types is dropped silently by the parser rather than persisted or raised as an error.

- FR1.6. A `tool_result` payload is truncated at write time to at most 2KB.

- FR1.7. Each individual tool input is truncated at write time to at most 1KB, and all tool inputs on one row to at most 4KB in total.

- FR1.8. The file paths a tool call touches are extracted into `filePaths` at write time rather than derived by readers from the payload.

- FR1.8a. The `summary` field is one human-readable line describing the event, derived at write time and truncated to at most 200 characters. It is a rendering convenience, never a parsing target: no reader may branch on its content, and it is null whenever no meaningful line can be derived. Its exact per-event-type wording is an implementation choice of the projector, not a contract this spec fixes.

- FR1.9. An event is correlated to its assembly-line node at write time by matching the envelope's `source.agent` against `pipeline.assembly_line_nodes.agent_cr_name`. ([validated by `agent-run-events.test.ts:35`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L35), [`agent-run-events.test.ts:301`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L301))

- FR1.9a. A correlation miss is not an error. When no node row matches the envelope's `source.agent` — because the event arrived before the node row carried its CR name, or because the CR belongs to no node at all — the row is still written, with `agentCrName` retained and `assemblyLineId`, `nodeId`, and `iteration` left null. Retaining `agentCrName` on an uncorrelated row is what keeps a later backfill possible; a backfill is not in scope here. ([validated by `agent-run-events.test.ts:60`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L60), [`agent-run-events.test.ts:74`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L74), [`agent-run-events.test.ts:152`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L152))

- FR1.10. The correlation lookup is served by a partial index on `pipeline.assembly_line_nodes (agent_cr_name)` where `agent_cr_name` is not null; that index does not exist today and is created by the migration that adds this table.

- FR1.11. The `assemblyLineId`, `nodeId`, and `iteration` fields are nullable, because agent CRs dispatched for a plain task rather than an assembly-line node are named from the task id and resolve to no node. ([validated by `agent-run-events.test.ts:60`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L60), [validated by `run-event-reducer.test.ts:179`](apps/web-ui/src/lib/run-event-reducer.test.ts#L179), [`run-event-reducer.test.ts:188`](apps/web-ui/src/lib/run-event-reducer.test.ts#L188))

- FR1.12. A double-wrapped envelope line of the shape `{source, event: {source, event}}` is projected rather than dropped.

- FR1.13. Rows older than 14 days are pruned. ([validated by `agent-run-events.test.ts:269`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L269), [`agent-run-events.test.ts:281`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L281), [`agent-run-events.test.ts:410`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L410))

### FR2 — Live transport

- FR2.1. The Floor exposes `GET /api/agent-events/stream/{assemblyLineId}` as a Server-Sent Events endpoint with the `text/event-stream` content type.

- FR2.2. Each event is framed as `id: <row.id>`, then `event: agent-event`, then `data: <row JSON>`.

- FR2.3. The stream replays matching rows from the database first and only then attaches to the live tail, so a client that connects mid-run sees the run from its start.

- FR2.4. A single `event: catchup-complete` frame is emitted between the database replay and the live tail.

- FR2.5. A `: ping` comment is emitted every 25 seconds to keep the connection open through idle-timeout intermediaries.

- FR2.6. The replay start cursor is the row id supplied by the client as a `Last-Event-ID` request header or as an `?after` query parameter. The replay query is additionally scoped to the `assemblyLineId` in the URL path: a cursor is a position, never an authorization, so a client presenting a cursor from another run receives that run's events only if it is already entitled to the run it asked for. An implementation that filters on `id > cursor` alone discloses one run's events to another run's subscriber. ([validated by `agent-run-events.test.ts:204`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L204), [`agent-run-events.test.ts:212`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L212), [`agent-run-events.test.ts:220`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L220), [`agent-run-events.test.ts:228`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L228), [`agent-run-events.test.ts:236`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L236), [`agent-run-events.test.ts:398`](libs/shared/src/project/agent-run-events/agent-run-events.test.ts#L398))

- FR2.7. Responses carry `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` so that no intermediary buffers the stream into unusable chunks.

### FR3 — History and definitions

- FR3.1. The Floor exposes `GET /api/agent-events/{assemblyLineId}` returning the persisted events of a finished run over plain REST.

- FR3.2. The Floor exposes `GET /api/assembly-line-definitions/{name}` returning the zod-parsed definition graph for a named assembly line.

### FR4 — Visualization

- FR4.1. The run page renders the assembly-line definition graph as a DAG whose node states update live.

- FR4.1a. The definition graph is laid out deterministically and without a layout dependency: a node sits one column right of its latest predecessor along the longest acyclic path, back-edges and self-loops are excluded from that layering so a retry loop cannot push its own target rightwards, a self-loop draws as a visible loop rather than a zero-length line, and a back-edge arcs below the node row rather than reading as another forward hop. ([validated by `dag-layout.test.ts:45`](apps/web-ui/src/lib/dag-layout.test.ts#L45), [`dag-layout.test.ts:59`](apps/web-ui/src/lib/dag-layout.test.ts#L59), [`dag-layout.test.ts:65`](apps/web-ui/src/lib/dag-layout.test.ts#L65), [`dag-layout.test.ts:71`](apps/web-ui/src/lib/dag-layout.test.ts#L71), [`dag-layout.test.ts:79`](apps/web-ui/src/lib/dag-layout.test.ts#L79), [`dag-layout.test.ts:85`](apps/web-ui/src/lib/dag-layout.test.ts#L85), [`dag-layout.test.ts:91`](apps/web-ui/src/lib/dag-layout.test.ts#L91), [`dag-layout.test.ts:97`](apps/web-ui/src/lib/dag-layout.test.ts#L97), [`dag-layout.test.ts:103`](apps/web-ui/src/lib/dag-layout.test.ts#L103), [`dag-layout.test.ts:118`](apps/web-ui/src/lib/dag-layout.test.ts#L118), [`dag-layout.test.ts:128`](apps/web-ui/src/lib/dag-layout.test.ts#L128), [`dag-layout.test.ts:138`](apps/web-ui/src/lib/dag-layout.test.ts#L138), [`dag-layout.test.ts:147`](apps/web-ui/src/lib/dag-layout.test.ts#L147), [`dag-layout.test.ts:153`](apps/web-ui/src/lib/dag-layout.test.ts#L153), [`dag-layout.test.ts:160`](apps/web-ui/src/lib/dag-layout.test.ts#L160), [`dag-layout.test.ts:172`](apps/web-ui/src/lib/dag-layout.test.ts#L172), [`dag-layout.test.ts:186`](apps/web-ui/src/lib/dag-layout.test.ts#L186), [`dag-layout.test.ts:204`](apps/web-ui/src/lib/dag-layout.test.ts#L204))

- FR4.2. Node state is seeded from `pipeline.assembly_line_nodes` and running-versus-finished is derived from the per-node `init` and `result` events. ([validated by `run-event-reducer.test.ts:51`](apps/web-ui/src/lib/run-event-reducer.test.ts#L51), [`run-event-reducer.test.ts:61`](apps/web-ui/src/lib/run-event-reducer.test.ts#L61), [`run-event-reducer.test.ts:69`](apps/web-ui/src/lib/run-event-reducer.test.ts#L69), [`run-event-reducer.test.ts:77`](apps/web-ui/src/lib/run-event-reducer.test.ts#L77), [`run-event-reducer.test.ts:91`](apps/web-ui/src/lib/run-event-reducer.test.ts#L91), [`run-event-reducer.test.ts:110`](apps/web-ui/src/lib/run-event-reducer.test.ts#L110), [`run-event-reducer.test.ts:121`](apps/web-ui/src/lib/run-event-reducer.test.ts#L121), [`run-event-reducer.test.ts:133`](apps/web-ui/src/lib/run-event-reducer.test.ts#L133), [`run-event-reducer.test.ts:142`](apps/web-ui/src/lib/run-event-reducer.test.ts#L142), [`run-event-reducer.test.ts:276`](apps/web-ui/src/lib/run-event-reducer.test.ts#L276))

- FR4.2a. A node presents in exactly four states — pending, running, succeeded, failed — each with one tone and one label, so a node can never claim a status the reducer cannot produce. ([validated by `run-node-status.test.ts:5`](apps/web-ui/src/lib/run-node-status.test.ts#L5), [`run-node-status.test.ts:12`](apps/web-ui/src/lib/run-node-status.test.ts#L12), [`run-node-status.test.ts:19`](apps/web-ui/src/lib/run-node-status.test.ts#L19), [`run-node-status.test.ts:26`](apps/web-ui/src/lib/run-node-status.test.ts#L26))

- FR4.3. An `init` event for iteration N+1 resets a previously failed node to running. ([validated by `run-event-reducer.test.ts:151`](apps/web-ui/src/lib/run-event-reducer.test.ts#L151))

- FR4.4. The page renders a per-node transcript, a file-attention heatmap over `filePaths`, and a run timeline. ([validated by `run-event-reducer.test.ts:167`](apps/web-ui/src/lib/run-event-reducer.test.ts#L167), [`run-event-reducer.test.ts:283`](apps/web-ui/src/lib/run-event-reducer.test.ts#L283), [`run-event-reducer.test.ts:292`](apps/web-ui/src/lib/run-event-reducer.test.ts#L292))

- FR4.5. The client-side transcript is capped at 500 events per node; beyond the cap the oldest events are dropped from the rendered list, and the view states that older events were dropped rather than silently presenting a partial transcript as whole. The cap bounds browser memory for an unbounded run; 500 is a starting value chosen to exceed any observed node's event count, and moving it breaks no contract. ([validated by `run-event-reducer.test.ts:197`](apps/web-ui/src/lib/run-event-reducer.test.ts#L197), [`run-event-reducer.test.ts:201`](apps/web-ui/src/lib/run-event-reducer.test.ts#L201), [`run-event-reducer.test.ts:209`](apps/web-ui/src/lib/run-event-reducer.test.ts#L209))

- FR4.6. The client reducer applies each arriving event in constant time rather than rescanning accumulated state. ([validated by `run-event-reducer.test.ts:253`](apps/web-ui/src/lib/run-event-reducer.test.ts#L253), [`run-event-reducer.test.ts:263`](apps/web-ui/src/lib/run-event-reducer.test.ts#L263), [`run-event-reducer.test.ts:312`](apps/web-ui/src/lib/run-event-reducer.test.ts#L312))

- FR4.6a. Replay and the live stream share one reducer, so folding the first N events of a run yields exactly the state the live client held after its Nth event. ([validated by `run-event-reducer.test.ts:323`](apps/web-ui/src/lib/run-event-reducer.test.ts#L323), [`run-event-reducer.test.ts:338`](apps/web-ui/src/lib/run-event-reducer.test.ts#L338))

- FR4.7. The web-ui reaches the Floor only through session-authenticated Next.js proxy routes, never directly from the browser.

- FR4.8. The proxy hop repeats the `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` headers of the Floor hop.

- FR4.9. No component whose filename ends in `View`, `Card`, `Table`, `Section`, `Badge`, or `Row` constructs an `EventSource`, a `WebSocket`, or an `XMLHttpRequest`, nor imports `@/lib/db` or `@/lib/github`, because `lore/no-io-in-view` denylists all of them at those suffixes.

- FR4.10. The `AgentRunEventRow` type is canonical in `libs/shared` and hand-mirrored in `apps/web-ui`, with a compile-time drift guard under `scripts/type-drift/` asserting the mirror carries every canonical key. ([validated by `run-stream-types.test.ts:22`](apps/web-ui/src/lib/run-stream-types.test.ts#L22), [`run-stream-types.test.ts:26`](apps/web-ui/src/lib/run-stream-types.test.ts#L26), [`run-stream-types.test.ts:62`](apps/web-ui/src/lib/run-stream-types.test.ts#L62), [`run-stream-types.test.ts:85`](apps/web-ui/src/lib/run-stream-types.test.ts#L85))

- FR4.10a. The browser parses one SSE `data:` payload with a tolerant parser that yields nothing — never an exception — for malformed JSON, a non-object body, a missing identity field, or an event type it does not know. Dropping an unknown type silently is the forward-compatibility contract: the Floor may add a stream-json kind without breaking a deployed browser tab. ([validated by `run-stream-types.test.ts:32`](apps/web-ui/src/lib/run-stream-types.test.ts#L32), [`run-stream-types.test.ts:36`](apps/web-ui/src/lib/run-stream-types.test.ts#L36), [`run-stream-types.test.ts:44`](apps/web-ui/src/lib/run-stream-types.test.ts#L44), [`run-stream-types.test.ts:50`](apps/web-ui/src/lib/run-stream-types.test.ts#L50), [`run-stream-types.test.ts:93`](apps/web-ui/src/lib/run-stream-types.test.ts#L93))

### FR5 — Resilience

- FR5.1. A failure to persist visualization rows never fails the request; `POST /api/agent-events` continues to return success and to record its cost rows.

- FR5.2. A single malformed or unprojectable line never drops the rest of its batch.

- FR5.3. A client that reconnects with a `Last-Event-ID` receives every event after that id with no gap and no duplicate. ([validated by `run-event-reducer.test.ts:224`](apps/web-ui/src/lib/run-event-reducer.test.ts#L224), [`run-event-reducer.test.ts:232`](apps/web-ui/src/lib/run-event-reducer.test.ts#L232), [`run-event-reducer.test.ts:242`](apps/web-ui/src/lib/run-event-reducer.test.ts#L242), [`run-event-reducer.test.ts:303`](apps/web-ui/src/lib/run-event-reducer.test.ts#L303))

- FR5.4. A subscriber that cannot keep up with the live tail is disconnected rather than allowed to apply back-pressure to the Floor. The bound is the subscriber's own buffer: each subscription holds at most 1000 undelivered events, and on overflow the server drops the subscriber and closes the connection. Dropping is safe precisely because it is recoverable — the client's `EventSource` reconnects with its `Last-Event-ID` and FR5.3 replays the gap from the database, so a slow reader loses latency, never data. The buffer is what makes this bounded; an implementation that lets an unread subscriber grow the Floor's heap satisfies neither this FR nor FR5.1.

## Key Entities

- `pipeline.agent_run_events` — the projected event rows; the storage layer for FR1.
- `pipeline.assembly_line_nodes` — the pre-existing per-node walk state; the seed for FR4.2 and the correlation target for FR1.9.
- `pipeline.llm_calls` — the pre-existing cost projection; unchanged by this feature.

## Open Questions

- `GET /api/assembly-line-definitions/{name}` (FR3.2) has no obviously owning implementation issue on the epic's current child list and may need one.
- Definition graphs are at most 7 nodes today, which is what makes a hand-rolled SVG layout tractable; the fallback for a substantially larger graph is named in ADR-037 but not yet specified here.
