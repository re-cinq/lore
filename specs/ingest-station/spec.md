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
  ([validated by `ingest.test.ts:77`](apps/stations/src/stations/ingest/ingest.test.ts#L77), [`ingest.test.ts:90`](apps/stations/src/stations/ingest/ingest.test.ts#L90), [`ingest.test.ts:102`](apps/stations/src/stations/ingest/ingest.test.ts#L102), [`ingest.test.ts:120`](apps/stations/src/stations/ingest/ingest.test.ts#L120), [`ingest.test.ts:142`](apps/stations/src/stations/ingest/ingest.test.ts#L142), [`ingest.test.ts:295`](apps/stations/src/stations/ingest/ingest.test.ts#L295), [`ingest-graph-task.test.ts:160`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L160), [`ingest-spec-trace.test.ts:103`](libs/shared/src/spec-trace/ingest-spec-trace.test.ts#L103), [`ingest-spec-trace.test.ts:138`](libs/shared/src/spec-trace/ingest-spec-trace.test.ts#L138), [`ingest-spec-trace-unknown-kind.test.ts:10`](libs/shared/src/spec-trace/ingest-spec-trace-unknown-kind.test.ts#L10); implemented by [`ingest.ts:71`](apps/stations/src/stations/ingest/ingest.ts#L71))

- **FR2 — dispatch.** A single-node detect-shaped assembly line definition
  (`libs/assembly-lines/src/assembly-lines/ingest.yaml`, node type `ingest`) rides
  the standard event-driven walk, per-node timeout, and reaper. With the line
  starter wired, the Floor's spec-trace dispatch routes docs kinds to
  `assemblyLines().start("ingest", …)`. The line's `branch` is ONLY the
  overlap-guard lease key, `ingest/<kind>/<ref>[/<chunk>]` — the
  specs/adrs/test-report lines of one push must not take each other's lease (a
  bare `branch=<sha>` closed all but one of every push's lines as
  `finished/lease_held`, 2026-07-17), and chunked work leases per chunk: a
  payload kind appends its scheduling event's id and a force pass's
  per-directory child appends its glob, because sibling chunks are distinct
  units of work — a bare `(kind, ref)` key closed every test-report chunk after
  the first as `lease_held` while the first still ran, silently dropping all
  but one ~512 KB chunk of each push's report (2026-07-31); the pod clones at
  `args.ref` (full clone + `git checkout <ref>`),
  which the node spec builders prefer over the lease key for the CR's branch and
  `station_input.branch`. `kind`/`ref`/`glob`/`force` thread as string args into
  `station_input.params` and the event marks done; convergence, retry, and
  dead-letter shift from the event loop to the line machinery (the reaper is the
  liveness bound; ADR-031 FR6.10). Force-without-glob still self-chunks into
  child events BEFORE any line starts. The per-task provisioner materialises the
  pod's clone triple from the recipe the node actually runs on —
  `stationRef ?? taskType` — because a task-less line's `taskType` is its
  definition name, which is no catalog recipe at all (the day-one lookup miss
  left ingest pods with no `/workspace/target`), and a task-backed line's
  station node would otherwise clone the task type's LLM recipe. Only station
  types that work on the checkout (`ingest`, `validate`) provision the
  token/clone triple at all — API-reading nodes (detect/gate/retrospective/
  triage/github_action) set `clone: false`, because their line branch is a
  synthetic lease key (`detect/<definition>/<repo>`) that `git checkout` cannot
  resolve, and a forced clone would fail their init.
  ([validated by `spec-trace-dispatch:35`](apps/floor/src/jobs/spec-trace/spec-trace-dispatch.test.ts#L29), [`spec-trace-dispatch:65`](apps/floor/src/jobs/spec-trace/spec-trace-dispatch.test.ts#L58), [`spec-trace-dispatch:170`](apps/floor/src/jobs/spec-trace/spec-trace-dispatch.test.ts#L163), [`spec-trace-dispatch:214`](apps/floor/src/jobs/spec-trace/spec-trace-dispatch.test.ts#L186), [`floor-assembly-run:197`](apps/floor/src/jobs/assembly-run/floor-assembly-run.test.ts#L189), [`floor-assembly-run:180`](apps/floor/src/jobs/assembly-run/floor-assembly-run.test.ts#L172), [`agent-backend:150`](libs/shared/src/cluster/agent-backend.test.ts#L148), [`per-task-token:64`](libs/shared/src/cluster/per-task-token.test.ts#L64), [`per-task-token:70`](libs/shared/src/cluster/per-task-token.test.ts#L70), [`loader:231`](libs/assembly-lines/src/loader.test.ts#L481); implemented by [`spec-trace-dispatch.ts:71`](apps/floor/src/jobs/spec-trace/spec-trace-dispatch.ts#L71), [`ingest.yaml:1`](libs/assembly-lines/src/assembly-lines/ingest.yaml#L1))

- **FR3 — payload transport.** `station_input` carries kind + a payload *reference*,
  never an inline test-report body: report payloads reach ~1 MB (the HTTP body
  limit) while `station_input` is an argv element. The Floor threads the scheduling
  event's id into the line args (`payload_event_id`); the station fetches the body
  back from `GET /api/repos/:o/:r/events/:id/payload` (read scope, repo must match
  the row) and runs `ingestSpecTrace`; docs kinds need only `{commit, glob, force}`
  inline.
  ([validated by `ingest.test.ts:194`](apps/stations/src/stations/ingest/ingest.test.ts#L194), [`ingest.test.ts:220`](apps/stations/src/stations/ingest/ingest.test.ts#L220), [`event-payload.test.ts:29`](apps/lore-api/src/api/routes/ingest/event-payload.test.ts#L29), [`event-payload.test.ts:42`](apps/lore-api/src/api/routes/ingest/event-payload.test.ts#L42), [`event-payload.test.ts:52`](apps/lore-api/src/api/routes/ingest/event-payload.test.ts#L52), [`spec-trace-dispatch:193`](apps/floor/src/jobs/spec-trace/spec-trace-dispatch.test.ts#L186), [`drain-loop.test.ts:110`](apps/floor/src/main-loop/loop.test.ts#L110); implemented by [`event-payload.ts:14`](apps/lore-api/src/api/routes/ingest/event-payload.ts#L14))

- **FR4 — network policy + pod providers.** A label-scoped NetworkPolicy
  (`ingest-station-egress`, selecting the `lore.re-cinq.com/dgraph-egress`
  pod-TEMPLATE label seeded from task-types `pod_labels` — never the station
  name, which the per-task clone rewrites to `pt-<id>` and silently strands
  the policy)
  grants egress to dgraph ONLY for ingest-station pods; all other station/agent
  pods keep the D7 posture. The `def-ingest` recipe alone injects
  `LORE_DGRAPH_HTTP` via `AgentDefinition.spec.resources.env` — the controller
  folds recipe env into the run env, while a Station pod-template env block is
  OVERWRITTEN and silently lost (learned live: the first prod pods failed with
  "LORE_DGRAPH_HTTP not configured" while the template carried it). EVERY
  seeded station recipe carries the `LORE_API_URL` env (`.Values.loreApiUrl` —
  the IN-CLUSTER service URL plus a matching `apiSink` egress rule: the external
  LB VIP is DNAT-short-circuited by Dataplane V2 to the backend pod IP, which
  the egress policy's RFC1918 except-list then drops — proven live when
  api.anthropic.com answered while both Lore VIPs timed out) plus
  the `LORE_INGEST_TOKEN` secret: `createStationProject` requires them, and no
  detect/ingest pod ever had them before this pair (detect lines failed for five
  straight days as "createStationProject requires LORE_API_URL"). Statement
  embeddings ride `POST /api/embed` — the API proxies Vertex on its own
  credentials, so no GCP identity ever reaches a run pod; the route has its own
  1200/min rate bucket (a 7-file changed-spec batch fired ~250 calls in seconds
  and the 200/min `default` bucket 429'd them all, 2026-07-17) and `apiEmbed`
  retries a 429 up to three times (2s/5s/15s) before failing the file. No dispatch assembles context at
  all any more (the `hydrate` flag and both `ContextSource` implementations were
  removed 2026-08-28): the exec recipe renders only `{station_input}`, and the
  empty-description dispatch that used to assemble an unbounded-query context
  (~3 MB) — blowing the 2 MiB apiserver limit and blocking every ingest CR create
  on day one — has nothing left to assemble.
  ([validated by `agent-catalog.test.ts:332`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L332), [`agent-catalog.test.ts:332`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L332), [`agent-catalog.test.ts:350`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L350), [`agent-catalog.test.ts:122`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L122), [`agent-catalog.test.ts:241`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L241), [`rate-limit.test.ts:26`](apps/lore-api/src/server/plugins/rate-limit.test.ts#L26), [`ingest.test.ts:258`](apps/stations/src/stations/ingest/ingest.test.ts#L258), [`ingest.test.ts:280`](apps/stations/src/stations/ingest/ingest.test.ts#L280), [`embed.test.ts:33`](apps/lore-api/src/api/routes/ingest/embed.test.ts#L33), [`embed.test.ts:40`](apps/lore-api/src/api/routes/ingest/embed.test.ts#L40), [`embed.test.ts:47`](apps/lore-api/src/api/routes/ingest/embed.test.ts#L47), [`ingest.test.ts:231`](apps/stations/src/stations/ingest/ingest.test.ts#L231), [`ingest.test.ts:250`](apps/stations/src/stations/ingest/ingest.test.ts#L250); implemented by [`ingest-station-egress.yaml:1`](infra/terraform/modules/gke-mcp/lore-platform/charts/ai-agents-helm/templates/ingest-station-egress.yaml#L1), [`embed.ts:27`](apps/lore-api/src/api/routes/ingest/embed.ts#L27))

- **FR5 — validate substrate dedup.** The post-ingest `spec_coverage_validate`
  event routes through the SAME production detect-tick handler as the weekly cron
  (`params.repo` narrows it to the ingested repo, job-run bookkeeping and the
  overlap-guard branch included) — the validate core runs in the detect station
  pod on both triggers, never inline in the Floor.
  ([validated by `registry.test.ts:43`](apps/floor/src/main-loop/registry.test.ts#L43); implemented by [`registry.ts:70`](apps/floor/src/main-loop/registry.ts#L70))

- **FR6 — the Floor is pure orchestration.** With no in-process dgraph writer left,
  `SERIAL_FAMILIES` empties (chunk isolation comes from one-pod-per-event, the
  station's own deadline, and dgraph retry-on-abort inside the pod), and the
  serial-family machinery in the loop remains only as a general mechanism
  (injected via `LoopDeps.serialFamilies`). The inline projector and payload
  ingest are DELETED from `dispatchSpecTrace`: a docs kind without the line
  starter, a payload kind without the scheduling event's id, and an unknown
  kind all enforce-throw — the Floor's only remaining repo read is the
  force-pass self-chunking tree listing, and the spec_trace handler no longer
  needs a dgraph client at all (the `LORE_DGRAPH_HTTP` check remains only as
  the feature gate).
  ([validated by `spec-trace-dispatch:86`](apps/floor/src/jobs/spec-trace/spec-trace-dispatch.test.ts#L79), [`spec-trace-dispatch:237`](apps/floor/src/jobs/spec-trace/spec-trace-dispatch.test.ts#L231), [`spec-trace-dispatch:251`](apps/floor/src/jobs/spec-trace/spec-trace-dispatch.test.ts#L245), [`drain-loop.test.ts:150`](libs/shared/src/project/events/drain-loop.test.ts#L150); implemented by [`loop.ts:53`](libs/shared/src/project/events/drain-loop.ts#L53), [`internal.ts:18`](apps/floor/src/jobs/internal.ts#L18))

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
