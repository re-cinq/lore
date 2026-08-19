# Feature Specification: POST /api/task-turns/{taskId}

| Field      | Value                                                                  |
|------------|------------------------------------------------------------------------|
| Feature    | Local-run transcript relay                                             |
| Status     | In Progress                                                            |
| Created    | 2026-08-18                                                             |
| Owner      | Platform Engineering                                                   |
| Route      | `POST /api/task-turns/{taskId}`                                        |
| Auth scope | `write`                                                                |
| Module     | Tasks (`api/routes/tasks/task-turns.ts` → `taskTurnsPostRoute`)        |

POST /api/task-turns/{taskId} relays a locally-run task's redacted claude
stream-json transcript to the Floor's `/api/agent-events` sink, so local runs
land in `pipeline.agent_run_turns` like cluster runs (issue #1295, the
write-side precondition of the #1148 GCS-logs cutover).

## Problem Statement

Cluster pods stream their run output to the Floor's `/api/agent-events` ingest
and land in the turn-level transcript store; local runs only uploaded a plain
text log to GCS. The Floor's ingress is deliberately cluster-internal
(`infra/terraform/lore-floor.tf` exposes only the `/api/webhook` prefix), and
its sink is authorized by `LORE_AGENT_INTERNAL_TOKEN`, which laptops must never
hold. lore-api already mounts both the Floor's in-cluster URL
(`LORE_AGENT_URL`) and the internal token, so it relays: the laptop posts with
the write-scoped token it already has, and lore-api attaches the internal
credentials.

## Interface

Registered in `routeList`
([registration](../../../apps/lore-api/src/server/build-server.ts#L134),
[handler](../../../apps/lore-api/src/api/routes/tasks/task-turns.ts#L65)).

- **Method + path**: `POST /api/task-turns/{taskId}`; `taskId` must be a UUID.
- **Auth scope**: `write`. Rate-limit bucket `turns` (300/min) — a run-end
  relay is a burst of batches, which must neither starve nor be starved by
  `default`.
- **Body**: raw NDJSON (`payload.parse: false`) — one claude stream-json line
  per row, already redacted on the laptop before anything left the machine.

### Response

| Status | Body                              | When                                        |
|--------|-----------------------------------|---------------------------------------------|
| 200    | `{ forwarded, skipped }`          | Relayed (or nothing relayable — no upstream call). |
| 400    | zod error                         | `taskId` is not a UUID.                     |
| 404    | `{ error: "task not found: …" }`  | No `pipeline.tasks` row for `taskId`.       |
| 502    | `{ error: "floor relay failed…" }`| The Floor rejected the forward.             |
| 503    | `{ error: … }`                    | Relay env or DB pool unavailable.           |

## Behavior

1. Require `LORE_AGENT_URL` + `LORE_AGENT_INTERNAL_TOKEN`, else 503; require
   the pool, else 503. ([validated by returns 503 when the Floor relay env is not configured](../../../apps/lore-api/src/api/routes/tasks/task-turns.test.ts#L120), [validated by returns 503 when the internal token is missing even though the floor URL is set](../../../apps/lore-api/src/api/routes/tasks/task-turns.test.ts#L159), [validated by returns 503 when no pool is available](../../../apps/lore-api/src/api/routes/tasks/task-turns.test.ts#L114))
2. The task id keys everything the Floor sink writes (`llm_calls`, run events,
   turns), so an unknown id is refused with 404 rather than stored
   uncorrelated. Ownership is NOT checked — any write-scoped token may post
   under any existing task id, matching the `/api/task-logs` precedent (which
   checks nothing at all); the guarantee here is only that fabricated ids are
   refused. ([validated by returns 404 when the task does not exist](../../../apps/lore-api/src/api/routes/tasks/task-turns.test.ts#L104), [validated by returns 400 when taskId is not a uuid](../../../apps/lore-api/src/api/routes/tasks/task-turns.test.ts#L135))
3. Split the body on newlines; a relayable line must parse as a plain JSON
   object and must NOT be an attributed envelope (`source` + `event` keys —
   the double-peel in `unwrapAttribution` would let a forged inner source
   correlate fake turns to a real assembly run) and must NOT be a
   `kind: "file"` event (it drives planning-round settlement and artifact
   merge). Everything else is counted in `skipped`. ([validated by skips non-JSON lines, file-kind events, and pre-attributed envelopes](../../../apps/lore-api/src/api/routes/tasks/task-turns.test.ts#L78))
4. Wrap each survivor as `{"source":{"task":<taskId>},"event":<line>}` — the
   station contract's attribution envelope, raw line embedded verbatim — and
   forward the joined NDJSON to `${LORE_AGENT_URL}/api/agent-events` with
   `Bearer LORE_AGENT_INTERNAL_TOKEN`. ([validated by wraps each line in the task attribution envelope and forwards NDJSON to the Floor](../../../apps/lore-api/src/api/routes/tasks/task-turns.test.ts#L54))
5. Zero survivors → 200 `{ forwarded: 0, skipped }` without calling the Floor. ([validated by returns 200 without calling the Floor when no line survives filtering](../../../apps/lore-api/src/api/routes/tasks/task-turns.test.ts#L97))
6. A non-OK upstream response → 502. ([validated by returns 502 when the Floor rejects the forward](../../../apps/lore-api/src/api/routes/tasks/task-turns.test.ts#L128))
7. Write scope is enforced like every task route. ([validated by returns 403 when the token has task scope but not write](../../../apps/lore-api/src/api/routes/tasks/task-turns.test.ts#L146))

## Producer (mcp-server local runner)

The laptop side lives in `apps/mcp-server/src/features/pipeline/runner.local.ts`:
both `claude` spawns emit `--output-format stream-json`, stderr is captured in
a sibling `.err` file so it cannot corrupt an NDJSON line, and
`persistRunArtifacts` runs on every monitor exit path (including the
needs-human-help early return, which previously skipped the GCS upload
entirely).

1. `buildTurnLines` redacts PER LINE — the same rule as the Floor's own turn
   collector, because a whole-text redaction pass can span JSON boundaries and
   erase every line in between. Non-JSON lines are not turns and are skipped
   silently; a line whose JSON breaks under redaction is dropped and counted. ([validated by keeps parseable stream-json lines untouched](../../../apps/mcp-server/src/features/pipeline/runner.local.test.ts#L339), [validated by skips non-JSON lines without counting them as dropped](../../../apps/mcp-server/src/features/pipeline/runner.local.test.ts#L351), [validated by redacts a secret inside a line and keeps the still-parseable result](../../../apps/mcp-server/src/features/pipeline/runner.local.test.ts#L363), [validated by drops and counts a line whose JSON breaks under redaction](../../../apps/mcp-server/src/features/pipeline/runner.local.test.ts#L376))
2. `batchTurnLines` splits the relay into batches capped by utf-8 bytes
   (~700KB, under lore-api's 1MB body limit) and line count (2000, under the
   Floor's 10k-turns-per-batch cap). ([validated by splits on the line cap](../../../apps/mcp-server/src/features/pipeline/runner.local.test.ts#L392), [validated by splits on the byte cap measured with Buffer.byteLength](../../../apps/mcp-server/src/features/pipeline/runner.local.test.ts#L402), [validated by emits a line larger than the byte cap as its own batch](../../../apps/mcp-server/src/features/pipeline/runner.local.test.ts#L413))
3. A line that can never fit one relay request (its own bytes exceed the batch
   cap) is dropped BEFORE batching, with a counted warning — shipping it would
   413 and cost the batches behind it. A failed batch is likewise counted and
   skipped, never allowed to abandon the rest: the terminal result line rides
   last, so aborting mid-relay would silently lose the cost row and the
   transcript tail. ([validated by keeps lines at or under the byte cap and counts the rest](../../../apps/mcp-server/src/features/pipeline/runner.local.test.ts#L430), [validated by measures utf-8 bytes plus the join newline, not characters](../../../apps/mcp-server/src/features/pipeline/runner.local.test.ts#L440))

## Alternatives rejected

- **Direct laptop → Floor ingest** (the issue's primary suggestion): the Floor
  ingress exposes only `/api/webhook`; `/api/agent-events` is cluster-internal
  by documented decision, and accepting the shared ingest token there would
  hand laptop-resident credentials the sink's most privileged writes
  (planning settlement, artifact merge).
- **Split-brain** (keep GCS for local runs, reader fallback): keeps the bucket
  dependency alive and forces dual read paths, contradicting the #1148
  cutover.
