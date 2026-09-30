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
  ([validated by `ingest.test.ts:95`](apps/stations/src/work/ingest/ingest.test.ts#L95), [`ingest.test.ts:108`](apps/stations/src/work/ingest/ingest.test.ts#L108), [`ingest.test.ts:120`](apps/stations/src/work/ingest/ingest.test.ts#L120), [`ingest.test.ts:138`](apps/stations/src/work/ingest/ingest.test.ts#L142), [`ingest.test.ts:160`](apps/stations/src/work/ingest/ingest.test.ts#L164), [`ingest.test.ts:311`](apps/stations/src/work/ingest/ingest.test.ts#L339), [`ingest.test.ts:321`](apps/stations/src/work/ingest/ingest.test.ts#L349), [`ingest.test.ts:331`](apps/stations/src/work/ingest/ingest.test.ts#L359), [`ingest-graph-task.test.ts:160`](libs/shared/src/work/spec-trace/ingest-graph-task.test.ts#L160), [`ingest-spec-trace.test.ts:63`](libs/shared/src/work/spec-trace/ingest-spec-trace.test.ts#L63), [`ingest-spec-trace.test.ts:122`](libs/shared/src/work/spec-trace/ingest-spec-trace.test.ts#L122), [`ingest-spec-trace-unknown-kind.test.ts:10`](libs/shared/src/work/spec-trace/ingest-spec-trace-unknown-kind.test.ts#L10); implemented by [`ingest.ts:71`](apps/stations/src/work/ingest/ingest.ts#L71))

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
  ([validated by `spec-trace-dispatch:35`](apps/floor/src/work/spec-trace/spec-trace-dispatch.test.ts#L29), [`spec-trace-dispatch:65`](apps/floor/src/work/spec-trace/spec-trace-dispatch.test.ts#L58), [`spec-trace-dispatch:170`](apps/floor/src/work/spec-trace/spec-trace-dispatch.test.ts#L163), [`spec-trace-dispatch:214`](apps/floor/src/work/spec-trace/spec-trace-dispatch.test.ts#L186), [`floor-assembly-run:197`](apps/floor/src/work/assembly-run/floor-assembly-run.test.ts#L185), [`floor-assembly-run:180`](apps/floor/src/work/assembly-run/floor-assembly-run.test.ts#L172), [`agent-backend:150`](libs/shared/src/outbound/cluster/agent-backend.test.ts#L190), [`per-task-token:64`](libs/shared/src/outbound/cluster/per-task-token.test.ts#L64), [`per-task-token:70`](libs/shared/src/outbound/cluster/per-task-token.test.ts#L70), [`loader:231`](libs/assembly-lines/src/loader.test.ts#L510); implemented by [`spec-trace-dispatch.ts:71`](apps/floor/src/work/spec-trace/spec-trace-dispatch.ts#L99), [`ingest.yaml:1`](libs/assembly-lines/src/assembly-lines/ingest.yaml#L1))

- **FR3 — payload transport.** `station_input` carries kind + a payload *reference*,
  never an inline test-report body: report payloads reach ~1 MB (the HTTP body
  limit) while `station_input` is an argv element. The Floor threads the scheduling
  event's id into the line args (`payload_event_id`); the station fetches the body
  back from `GET /api/repos/:o/:r/events/:id/payload` (read scope, repo must match
  the row) and runs `ingestSpecTrace`; docs kinds need only `{commit, glob, force}`
  inline.
  ([validated by `ingest.test.ts:210`](apps/stations/src/work/ingest/ingest.test.ts#L214), [`ingest.test.ts:236`](apps/stations/src/work/ingest/ingest.test.ts#L240), [`event-payload.test.ts:29`](apps/lore-api/src/transport/routes/ingest/event-payload.test.ts#L29), [`event-payload.test.ts:42`](apps/lore-api/src/transport/routes/ingest/event-payload.test.ts#L42), [`event-payload.test.ts:52`](apps/lore-api/src/transport/routes/ingest/event-payload.test.ts#L52), [`spec-trace-dispatch:193`](apps/floor/src/work/spec-trace/spec-trace-dispatch.test.ts#L186); implemented by [`event-payload.ts:14`](apps/lore-api/src/transport/routes/ingest/event-payload.ts#L14))

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
  embeddings ride `POST /api/embeddings` — the API proxies Vertex on its own
  credentials, so no GCP identity ever reaches a run pod. A spec file's
  statements and acceptance criteria are embedded in ONE batch before any node
  is written, posted in requests of at most 250 texts and 50,000 characters
  (Vertex's per-call ceilings), never one request per statement: embedding a
  100 KB spec statement by statement took ~110 s a file, and a push that
  rewrote five of them ran every re-cinq/Otto specs ingest into its 10-minute
  deadline (2026-09-28). The route has its own 1200/min `embed` rate bucket (a 7-file changed-spec batch fired
  ~250 calls in seconds and the 200/min `default` bucket 429'd them all,
  2026-07-17), and `apiEmbed` retries a 429 up to three times (2s/5s/15s)
  before failing the file. No dispatch assembles context at
  all any more (the `hydrate` flag and both `ContextSource` implementations were
  removed 2026-08-28): the exec recipe renders only `{station_input}`, and the
  empty-description dispatch that used to assemble an unbounded-query context
  (~3 MB) — blowing the 2 MiB apiserver limit and blocking every ingest CR create
  on day one — has nothing left to assemble.
  ([validated by renders the exec-vendor shape on the lore-station image with the ingest token](libs/shared/src/outbound/project/agents/agent-crd.test.ts#L301), [the dgraphUrl option repoints a config LORE_DGRAPH_HTTP entry](libs/shared/src/outbound/project/agents/agent-crd.test.ts#L343), [routes /api/embeddings to its own 1200/min bucket — the station's embedding burst must not starve (or be starved by) the 200/min default](apps/lore-api/src/transport/http/rate-limit.test.ts#L26), [apiEmbed posts the texts to /api/embeddings and returns their embeddings in order](apps/stations/src/work/ingest/ingest.test.ts#L251), [apiEmbed posts 251 texts as 2 requests of 250 and 1](apps/stations/src/work/ingest/ingest.test.ts#L278), [apiEmbed retries a 429 after backing off and succeeds — stations on every repo share the API's embed bucket](apps/stations/src/work/ingest/ingest.test.ts#L300), [apiEmbed gives up after 4 429s (3 retries) with the status in the error](apps/stations/src/work/ingest/ingest.test.ts#L324), [returns one embedding per posted text, in order](apps/lore-api/src/transport/routes/ingest/embeddings.test.ts#L34), [returns null in the place of a text the provider could not embed](apps/lore-api/src/transport/routes/ingest/embeddings.test.ts#L41), [rejects 251 texts with 400](apps/lore-api/src/transport/routes/ingest/embeddings.test.ts#L47), [embeds a spec's 3 statements and 1 acceptance criterion in one embedder call of 4 texts](libs/shared/src/work/spec-trace/project-spec-file.test.ts#L285), [embeds three texts in one Vertex call and returns the vectors in input order](libs/shared/src/outbound/embeddings/embedding-service.test.ts#L218), [splits 251 short texts into batches of 250 and 1](libs/shared/src/outbound/embeddings/embedding-service.test.ts#L168), [rejects when dgraph is not injected and LORE_DGRAPH_HTTP is unset](apps/stations/src/work/ingest/ingest.test.ts#L392), [rejects an empty text list with 400](apps/lore-api/src/transport/routes/ingest/embeddings.test.ts#L53), [starts a new batch when the next 8000-char text would pass 50000 chars](libs/shared/src/outbound/embeddings/embedding-service.test.ts#L176), [returns no batches for no texts](libs/shared/src/outbound/embeddings/embedding-service.test.ts#L184), [returns null for every text when Vertex answers 403](libs/shared/src/outbound/embeddings/embedding-service.test.ts#L233), [returns an empty list for no texts without calling Vertex](libs/shared/src/outbound/embeddings/embedding-service.test.ts#L243); implemented by [`ingest-station-egress.yaml:1`](infra/terraform/modules/gke-mcp/lore-platform/charts/ai-agents-helm/templates/ingest-station-egress.yaml#L1), [`embeddings.ts:36`](apps/lore-api/src/transport/routes/ingest/embeddings.ts#L36), [`embedding-service.ts:86`](libs/shared/src/outbound/embeddings/embedding-service.ts#L86), [`project-spec-file.ts:163`](libs/shared/src/work/spec-trace/project-spec-file.ts#L163))

- **FR5 — validate substrate dedup.** The post-ingest `spec_coverage_validate`
  event routes through the SAME production detect-tick handler as the weekly cron
  (`params.repo` narrows it to the ingested repo, job-run bookkeeping and the
  overlap-guard branch included) — the validate core runs in the detect station
  pod on both triggers, never inline in the Floor.
  ([validated by `registry.test.ts:43`](apps/floor/src/events/main-loop/registry.test.ts#L66); implemented by [`registry.ts:70`](apps/floor/src/events/main-loop/registry.ts#L70))

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
  ([validated by `spec-trace-dispatch:86`](apps/floor/src/work/spec-trace/spec-trace-dispatch.test.ts#L79), [`spec-trace-dispatch:237`](apps/floor/src/work/spec-trace/spec-trace-dispatch.test.ts#L231), [`spec-trace-dispatch:251`](apps/floor/src/work/spec-trace/spec-trace-dispatch.test.ts#L245), [`drain-loop.test.ts:150`](libs/shared/src/outbound/project/events/drain-loop.test.ts#L150); implemented by [`loop.ts:53`](libs/shared/src/outbound/project/events/drain-loop.ts#L172), [`internal.ts:18`](apps/floor/src/events/handlers/internal.ts#L18))

- **FR7 — catalog.** A `def-ingest` recipe is seeded like the other builtins
  (a `def-<type>` row in `lore.agent_definitions`, rendered by each cluster-agent's catalog sync), with
  `execution_mode: exec`, the `lore-station` image, and a 30-minute deadline,
  matched by the `ingest` node's `timeout_minutes` so the reaper and the Job
  agree. The deadline is sized for a push that rewrites several large specs,
  not for the largest chunk alone: 10 minutes held a 41-file chunk (~7 min) but
  not five changed 100 KB specs (9.5 min, re-cinq/Otto, 2026-09-28). The
  per-directory self-chunking from #855 stays — the station inherits bounded
  units, it does not reintroduce whole-repo passes.

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
2. ~~Deadline sizing for `def-ingest` under force-chunk load~~ — resolved in FR7:
   30 minutes, with one batched embed call per spec file (FR4).
