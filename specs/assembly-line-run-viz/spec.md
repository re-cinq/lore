# Feature Specification: Assembly Line Run Visualization

| Field   | Value                    |
|---------|--------------------------|
| Feature | Assembly Line Run Visualization |
| Status  | Draft                    |
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
5–15 second `setInterval` poll, which cannot render a per-tool-call stream at a
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

- FR1.2. The canonical row contract is `AgentRunEventRow` with the fields `id` (a string-encoded bigint used as the stream cursor), `taskId`, `agentCrName`, `assemblyLineId`, `nodeId`, `iteration`, `eventType`, `toolName`, `toolUseId`, `isError`, `filePaths`, `summary`, `payload`, and `createdAt`.

- FR1.3. The `id` field crosses every wire boundary as a string and is never narrowed to a JavaScript number, because a bigint identity column exceeds `Number.MAX_SAFE_INTEGER`.

- FR1.4. The `eventType` field is one of `init`, `message`, `thinking`, `tool_call`, `tool_result`, or `result`.

- FR1.5. A line whose event type is not one of the six known types is dropped silently by the parser rather than persisted or raised as an error.

- FR1.6. A `tool_result` payload is truncated at write time to at most 2KB.

- FR1.7. Each individual tool input is truncated at write time to at most 1KB, and all tool inputs on one row to at most 4KB in total.

- FR1.8. The file paths a tool call touches are extracted into `filePaths` at write time rather than derived by readers from the payload.

- FR1.9. An event is correlated to its assembly-line node at write time by matching the envelope's `source.agent` against `pipeline.assembly_line_nodes.agent_cr_name`.

- FR1.10. The correlation lookup is served by a partial index on `pipeline.assembly_line_nodes (agent_cr_name)` where `agent_cr_name` is not null; that index does not exist today and is created by the migration that adds this table.

- FR1.11. The `assemblyLineId`, `nodeId`, and `iteration` fields are nullable, because agent CRs dispatched for a plain task rather than an assembly-line node are named from the task id and resolve to no node.

- FR1.12. A double-wrapped envelope line of the shape `{source, event: {source, event}}` is projected rather than dropped.

- FR1.13. Rows older than 14 days are pruned.

### FR2 — Live transport

- FR2.1. The Floor exposes `GET /api/agent-events/stream/{assemblyLineId}` as a Server-Sent Events endpoint with the `text/event-stream` content type.

- FR2.2. Each event is framed as `id: <row.id>`, then `event: agent-event`, then `data: <row JSON>`.

- FR2.3. The stream replays matching rows from the database first and only then attaches to the live tail, so a client that connects mid-run sees the run from its start.

- FR2.4. A single `event: catchup-complete` frame is emitted between the database replay and the live tail.

- FR2.5. A `: ping` comment is emitted every 25 seconds to keep the connection open through idle-timeout intermediaries.

- FR2.6. The replay start cursor is the row id supplied by the client as a `Last-Event-ID` request header or as an `?after` query parameter.

- FR2.7. Responses carry `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` so that no intermediary buffers the stream into unusable chunks.

### FR3 — History and definitions

- FR3.1. The Floor exposes `GET /api/agent-events/{assemblyLineId}` returning the persisted events of a finished run over plain REST.

- FR3.2. The Floor exposes `GET /api/assembly-line-definitions/{name}` returning the zod-parsed definition graph for a named assembly line.

### FR4 — Visualization

- FR4.1. The run page renders the assembly-line definition graph as a DAG whose node states update live.

- FR4.2. Node state is seeded from `pipeline.assembly_line_nodes` and running-versus-finished is derived from the per-node `init` and `result` events.

- FR4.3. An `init` event for iteration N+1 resets a previously failed node to running.

- FR4.4. The page renders a per-node transcript, a file-attention heatmap over `filePaths`, and a run timeline.

- FR4.5. The client-side transcript is capped per node so an unbounded run cannot exhaust browser memory.

- FR4.6. The client reducer applies each arriving event in constant time rather than rescanning accumulated state.

- FR4.7. The web-ui reaches the Floor only through session-authenticated Next.js proxy routes, never directly from the browser.

- FR4.8. The proxy hop repeats the `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` headers of the Floor hop.

- FR4.9. No component whose filename ends in `View`, `Card`, `Table`, `Section`, `Badge`, or `Row` constructs an `EventSource`, a `WebSocket`, or an `XMLHttpRequest`, nor imports `@/lib/db` or `@/lib/github`, because `lore/no-io-in-view` denylists all of them at those suffixes.

- FR4.10. The `AgentRunEventRow` type is canonical in `libs/shared` and hand-mirrored in `apps/web-ui`, with a compile-time drift guard under `scripts/type-drift/` asserting the mirror carries every canonical key.

### FR5 — Resilience

- FR5.1. A failure to persist visualization rows never fails the request; `POST /api/agent-events` continues to return success and to record its cost rows.

- FR5.2. A single malformed or unprojectable line never drops the rest of its batch.

- FR5.3. A client that reconnects with a `Last-Event-ID` receives every event after that id with no gap and no duplicate.

- FR5.4. A subscriber that cannot keep up with the live tail is disconnected rather than allowed to apply back-pressure to the Floor.

## Key Entities

- `pipeline.agent_run_events` — the projected event rows; the storage layer for FR1.
- `pipeline.assembly_line_nodes` — the pre-existing per-node walk state; the seed for FR4.2 and the correlation target for FR1.9.
- `pipeline.llm_calls` — the pre-existing cost projection; unchanged by this feature.

## Open Questions

- `GET /api/assembly-line-definitions/{name}` (FR3.2) has no obviously owning implementation issue on the epic's current child list and may need one.
- Definition graphs are at most 7 nodes today, which is what makes a hand-rolled SVG layout tractable; the fallback for a substantially larger graph is named in ADR-037 but not yet specified here.
