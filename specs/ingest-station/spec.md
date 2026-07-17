# Feature Specification: Ingest Station

| Field   | Value                                                                 |
|---------|-----------------------------------------------------------------------|
| Feature | Ingest station — the `internal.ingest.*` family leaves the Floor      |
| Status  | In Progress                                                                 |
| Created | 2026-07-17                                                            |
| Owner   | Platform Engineering                                                  |
| ADR     | [`ADR-031`](../../adrs/ADR-031-agent-station-crds.md) (ingest-station amendment, accepted 2026-07-17) |

Moves the last substantive in-process work out of the Floor: the `internal.ingest.*`
event family — docs projection (`spec_trace` kinds `specs`/`adrs`), test-report and
coverage ingest, and the post-ingest `spec_coverage_validate` pass — runs as a builtin
`ingest` **station** (one pod per event payload) instead of inside the Floor's event
loop, using the D7 decision recorded in the ADR amendment: label-scoped dgraph egress
for this station type only.

## Problem Statement

The 2026-07-16 outage recovery showed every failure mode of running real work inside
the orchestrator: ingest handlers outlived the event bus's 600s stuck-row visibility
timeout, reaped-but-still-running handlers became uncancellable zombies that aborted
their own retries, and one hung network call starved the serialized family until a pod
restart. Self-chunking (#855) bounds the handlers to seconds, but the architectural
home for per-unit isolation, hard deadlines, and kill-that-kills is a station pod
(ADR-031 D9) — the same journey the detection family already made.

## Functional Requirements

- **FR1 — station type.** The `lore-station` image gains a builtin `ingest` type
  (`lore-station ingest '<station_input>'`) that runs the existing shared cores by
  payload kind: `specs`/`adrs` → `runIngestGraph` projection, `test-report` →
  `ingestTestReport`, `coverage` → `ingestCoverageReport`,
  `spec-coverage-validate` → `validateSpecCoverageJob`. Outcome rides the standard
  `LORE_NODE_RESULT` line with the run summary (`projected/skipped/failed` or
  ingest counts) in `extras`; any partial per-file failure yields outcome `failed`
  with the file list, so the line's failed edge (not a silent `done`) owns retries.
  Docs kinds read the init container's local clone and accept `glob`/`force`
  params; the embedder threads through `IngestGraphPorts.embed` (station pods
  have no GCP ADC — provider wiring lands with FR4); payload kinds reject loudly
  until FR3.
  ([validated by `ingest.test.ts:76`](apps/lore-station/src/stations/ingest.test.ts#L76), [`ingest.test.ts:89`](apps/lore-station/src/stations/ingest.test.ts#L89), [`ingest.test.ts:101`](apps/lore-station/src/stations/ingest.test.ts#L101), [`ingest.test.ts:119`](apps/lore-station/src/stations/ingest.test.ts#L119), [`ingest.test.ts:142`](apps/lore-station/src/stations/ingest.test.ts#L142), [`ingest-graph-task.test.ts:145`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L145); implemented by [`ingest.ts:71`](apps/lore-station/src/stations/ingest.ts#L71))

- **FR2 — dispatch.** A single-node detect-shaped assembly line definition
  (`libs/assembly-lines/src/assembly-lines/ingest.yaml`) rides the standard
  event-driven walk, per-node timeout, and reaper. The Floor's `internal.ingest.*`
  handlers shrink to `assemblyLines().start("ingest", …)` with the event payload and
  mark the event done — convergence, retry, and dead-letter shift from the event loop
  to the line machinery (the reaper is the liveness bound; ADR-031 FR6.10).

- **FR3 — payload transport.** `station_input` carries kind + a payload *reference*,
  never an inline test-report body: report payloads reach ~1 MB (the HTTP body
  limit) while `station_input` is an argv element. The station fetches the payload
  from the Lore API by event id (a read-scoped endpoint added for this); docs kinds
  need only `{commit, glob, force}` inline.

- **FR4 — network policy.** A label-scoped NetworkPolicy grants egress to
  `lore-dgraph-alpha.lore-dgraph.svc:8080` ONLY to pods of the ingest station type;
  all other station/agent pods keep the D7 posture (Lore API only). The ingest
  recipe injects `LORE_DGRAPH_HTTP`; no other station type receives it.

- **FR5 — validate substrate dedup.** The post-ingest `spec_coverage_validate` path
  dispatches this station instead of running `validateSpecCoverageJob` inline, so
  the weekly detect line and the post-ingest trigger share one execution substrate.

- **FR6 — the Floor is pure orchestration.** With no in-process dgraph writer left,
  `SERIAL_FAMILIES` empties (chunk isolation comes from one-pod-per-event, the
  station's own deadline, and dgraph retry-on-abort inside the pod), and the
  serial-family machinery in the loop remains only as a general mechanism.

- **FR7 — catalog.** A `def-ingest` recipe is seeded like the other builtins
  (`scripts/task-types.yaml` `stations:` → gen-catalog + migration), with
  `execution_mode: exec`, the `lore-station` image, and a deadline sized for the
  largest chunk (the per-directory self-chunking from #855 stays — the station
  inherits bounded units, it does not reintroduce whole-repo passes).

## Non-goals

- Episode auto-curation's in-process Haiku call (flagged in the ADR amendment as a
  later retrospective-station candidate).
- The heavy batch CronJobs (reindex, evals, memory lifecycle) — ADR-019's carve-out
  stands; they already run as their own pods.
- Multi-repo fan-out changes: the cron fan-out and event topology stay as-is; only
  the execution substrate of the handler moves.

## Acceptance Criteria

1. A `specs` ingest event produces one ingest-station pod whose `LORE_NODE_RESULT`
   summary matches today's `projected/skipped/failed` log line, and the graph state
   after the run is byte-identical to the in-process path's (same completeness
   check: file sha256 == `content_hash`).
2. A test-report POST to the Floor `ci-tests` ingress lands in the graph via a
   station pod with no inline payload in `station_input`.
3. Killing an ingest-station pod mid-run leaves the event/line retryable and the
   content-hash gate open (no permanently-skipped partial file) — the #850 receipt
   semantics hold across the pod boundary.
4. A non-ingest station pod cannot reach dgraph (NetworkPolicy denies), verified in
   the deploy checklist.
5. `SERIAL_FAMILIES` is empty and the Floor's `internal.ingest.*` handlers contain
   no dgraph client construction.

## Open Questions

1. Event-id payload fetch (FR3): reuse `pipeline.events` row as the payload store
   with a scoped read endpoint, or a short-lived object in GCS? (Leaning events-row
   read — no new storage, payload already there.)
2. Deadline sizing for `def-ingest` under force-chunk load (largest observed chunk:
   41 files ≈ 7 min with embeddings) — 10 min deadline + the walk's `+2 min` buffer?
