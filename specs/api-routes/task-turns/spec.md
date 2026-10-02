# Feature Specification: POST /api/task-turns/{taskId}

| Field      | Value                                                                  |
|------------|------------------------------------------------------------------------|
| Feature    | Local-run transcript store                                             |
| Status     | In Progress                                                            |
| Created    | 2026-08-18                                                             |
| Owner      | Platform Engineering                                                   |
| Route      | `POST /api/task-turns/{taskId}`                                        |
| Auth scope | `write`                                                                |
| Module     | Tasks (`api/routes/tasks/task-turns.ts` → `taskTurnsPostRoute`)        |

POST /api/task-turns/{taskId} stores a locally-run task's redacted claude
stream-json transcript in `pipeline.agent_run_turns`, keyed by its task, so a
local run's turns sit beside a cluster run's (issue #1295).

## Problem Statement

Local runs only uploaded a plain text log; their turns were not in the
turn-level transcript store. Until 2026-10-02 this route relayed the lines to
the sink of Lore's own Floor (`/api/agent-events`), attaching the internal
token a laptop must never hold. The Floor is deleted (`specs/external-floor`
FR16.10), so lore-api writes the rows itself: same envelope, same keys, same
dedup.

## Interface

Registered in `routeList`
([registration](../../../apps/lore-api/src/app/build-server.ts#L134),
[handler](../../../apps/lore-api/src/transport/routes/tasks/task-turns.ts#L65)).

- **Method + path**: `POST /api/task-turns/{taskId}`; `taskId` must be a UUID.
- **Auth scope**: `write`. Rate-limit bucket `turns` (300/min) — a run-end
  relay is a burst of batches, which must neither starve nor be starved by
  `default`. ([validated by `rate-limit.test.ts:39`](../../../apps/lore-api/src/transport/http/rate-limit.test.ts#L39))
- **Body**: raw NDJSON (`payload.parse: false`) — one claude stream-json line
  per row, already redacted on the laptop before anything left the machine.
- **Header** (optional): `x-turn-offset` — the position of this POST's first
  line within the runner's full transcript buffer, used for dedup keying
  (#1389). Absent or malformed → per-POST occurrence fallback, never an error.

### Response

| Status | Body                              | When                                        |
|--------|-----------------------------------|---------------------------------------------|
| 200    | `{ forwarded, skipped }`          | Stored (or nothing storable — nothing written).    |
| 400    | zod error                         | `taskId` is not a UUID.                     |
| 404    | `{ error: "task not found: …" }`  | No `pipeline.tasks` row for `taskId`.       |
| 503    | `{ error: … }`                    | Relay env or DB pool unavailable.           |

## Behavior

1. Require the pool, else 503. ([validated by returns 503 when no pool is available](../../../apps/lore-api/src/transport/routes/tasks/task-turns.test.ts#L149))
2. The task id keys everything this route writes (`llm_calls`, run events,
   turns), so an unknown id is refused with 404 rather than stored
   uncorrelated. Ownership is NOT checked — any write-scoped token may post
   under any existing task id, matching the `/api/task-logs` precedent (which
   checks nothing at all); the guarantee here is only that fabricated ids are
   refused. ([validated by returns 404 when the task does not exist](../../../apps/lore-api/src/transport/routes/tasks/task-turns.test.ts#L139), [validated by returns 400 when taskId is not a uuid](../../../apps/lore-api/src/transport/routes/tasks/task-turns.test.ts#L155))
3. Split the body on newlines; a relayable line must parse as a plain JSON
   object and must NOT be an attributed envelope (`source` + `event` keys —
   the double-peel in `unwrapAttribution` would let a forged inner source
   correlate fake turns to a real assembly run) and must NOT be a
   `kind: "file"` event (it drives planning-round settlement and artifact
   merge). Everything else is counted in `skipped`. ([validated by skips non-JSON lines, file-kind events, and pre-attributed envelopes](../../../apps/lore-api/src/transport/routes/tasks/task-turns.test.ts#L95), [`task-turns.test.ts:105`](../../../apps/lore-api/src/transport/routes/tasks/task-turns.test.ts#L113))
4. Wrap each survivor as
   `{"source":{"task":<taskId>,"turn_key":<key>},"event":<line>}` — the
   station contract's attribution envelope, raw line embedded verbatim — and
   store each as one row of `pipeline.agent_run_turns`: the task id, the event's `type`, the envelope, and the key as the row's dedup key. ([validated by wraps each line in the task attribution envelope and stores it in the turn store, keyed by the task](../../../apps/lore-api/src/transport/routes/tasks/task-turns.test.ts#L70))
5. *(Added by #1389 — the relay used to be append-only where the GCS path it
   replaced was idempotent by overwrite.)* `turn_key` is the line's dedup
   identity: sha256 over (task id, slot, line bytes), where the slot is
   `x-turn-offset` + the line's position in this POST when the header is
   present, else the line's occurrence number within this POST. A retried or
   re-grown buffer therefore reproduces the keys of every line it already
   sent — the Floor's turn store skips them (`ON CONFLICT DO NOTHING`,
   counted as `turn_deduped`) instead of duplicating the transcript, and a
   batch is never rejected (ADR-037 skip-not-fail). Identical lines within
   one POST stay distinct either way; the occurrence fallback's known limit
   is byte-identical lines in different POSTs, which collide. The offset is
   TRUSTED from the client: a producer that sends wrong offsets for one task
   turns its own legitimate lines into dedup skips (dropped, counted
   Floor-side as `turn_deduped`) — the loss mode is dropped turns, not
   duplicates. Dedup covers ONLY `agent_run_turns`: a re-POSTed buffer still
   re-inserts `pipeline.llm_calls` cost rows and `agent_run_events` viz rows
   (follow-up #1394), and rows duplicated before #1389 stay until the 30-day
   prune ages them out. ([validated by
   stamps the same keys when the same body is retried](../../../apps/lore-api/src/transport/routes/tasks/task-turns.test.ts#L196),
   [validated by keys byte-identical lines within one POST apart](../../../apps/lore-api/src/transport/routes/tasks/task-turns.test.ts#L209),
   [validated by keys byte-identical lines apart under an offset header too](../../../apps/lore-api/src/transport/routes/tasks/task-turns.test.ts#L229),
   [validated by keys a line by its x-turn-offset position so a tail-only re-POST reproduces its key](../../../apps/lore-api/src/transport/routes/tasks/task-turns.test.ts#L216),
   [validated by keys identical lines under different tasks apart](../../../apps/lore-api/src/transport/routes/tasks/task-turns.test.ts#L240),
   [validated by falls back to per-POST occurrence keying when the offset header is not a number](../../../apps/lore-api/src/transport/routes/tasks/task-turns.test.ts#L251))
6. Zero survivors → 200 `{ forwarded: 0, skipped }` and stores nothing. ([validated by returns 200 and stores nothing when no line survives filtering](../../../apps/lore-api/src/transport/routes/tasks/task-turns.test.ts#L121))
7. Write scope is enforced like every task route. ([validated by returns 403 when the token has task scope but not write](../../../apps/lore-api/src/transport/routes/tasks/task-turns.test.ts#L166))

## Producer (mcp-server local runner)

The laptop side lives in `apps/mcp-server/src/work/pipeline/runner.local.ts`:
both `claude` spawns emit `--output-format stream-json`, stderr is captured in
a sibling `.err` file so it cannot corrupt an NDJSON line, and
`persistRunArtifacts` runs on every monitor exit path (including the
needs-human-help early return, which previously skipped the GCS upload
entirely).

1. `buildTurnLines` redacts PER LINE — the same rule as the Floor's own turn
   collector, because a whole-text redaction pass can span JSON boundaries and
   erase every line in between. Non-JSON lines are not turns and are skipped
   silently; a line whose JSON breaks under redaction is dropped and counted. ([validated by keeps parseable stream-json lines untouched](../../../apps/mcp-server/src/work/pipeline/runner.local.test.ts#L290), [validated by skips non-JSON lines without counting them as dropped](../../../apps/mcp-server/src/work/pipeline/runner.local.test.ts#L302), [validated by redacts a secret inside a line and keeps the still-parseable result](../../../apps/mcp-server/src/work/pipeline/runner.local.test.ts#L314), [validated by drops and counts a line whose JSON breaks under redaction](../../../apps/mcp-server/src/work/pipeline/runner.local.test.ts#L327))
2. `batchTurnLines` splits the relay into batches capped by utf-8 bytes
   (~700KB, under lore-api's 1MB body limit) and line count (2000, under the
   Floor's 10k-turns-per-batch cap). ([validated by splits on the line cap](../../../apps/mcp-server/src/work/pipeline/runner.local.test.ts#L339), [validated by splits on the byte cap measured with Buffer.byteLength](../../../apps/mcp-server/src/work/pipeline/runner.local.test.ts#L349), [validated by emits a line larger than the byte cap as its own batch](../../../apps/mcp-server/src/work/pipeline/runner.local.test.ts#L358))
3. A line that can never fit one relay request (its own bytes exceed the batch
   cap) is dropped BEFORE batching, with a counted warning — shipping it would
   413 and cost the batches behind it. A failed batch is likewise counted and
   skipped, never allowed to abandon the rest: the terminal result line rides
   last, so aborting mid-relay would silently lose the cost row and the
   transcript tail. ([validated by keeps lines at or under the byte cap and counts the rest](../../../apps/mcp-server/src/work/pipeline/runner.local.test.ts#L370), [validated by measures utf-8 bytes plus the join newline, not characters](../../../apps/mcp-server/src/work/pipeline/runner.local.test.ts#L380))
4. *(Added by #1389:)* `ingestTurns` sends each batch's cumulative line offset
   in `x-turn-offset`, advancing it past failed batches too — a batch consumes
   its transcript positions whether or not it relayed, so a later retry of the
   same buffer reproduces the same keys. ([validated by stamps each batch with its cumulative line offset](../../../apps/mcp-server/src/work/pipeline/runner.local.test.ts#L417), [validated by advances the offset past a failed batch so later lines keep their positions](../../../apps/mcp-server/src/work/pipeline/runner.local.test.ts#L429))
5. `ingestTurns` is a no-op (no fetch) when `LORE_API_URL`/`LORE_INGEST_TOKEN`
   are not configured, and warns-and-drops a line whose own bytes exceed the
   relay batch cap without ever fetching it. ([validated by returns without fetching when the API URL or token is not configured](../../../apps/mcp-server/src/work/pipeline/runner.local.test.ts#L443), [validated by warns and drops a line too large to ever fit a relay batch, without fetching it](../../../apps/mcp-server/src/work/pipeline/runner.local.test.ts#L457))

## Alternatives rejected

- **Direct laptop → Floor ingest** (the issue's primary suggestion): the Floor
  ingress exposes only `/api/webhook`; `/api/agent-events` is cluster-internal
  by documented decision, and accepting the shared ingest token there would
  hand laptop-resident credentials the sink's most privileged writes
  (planning settlement, artifact merge).
- **Split-brain** (keep GCS for local runs, reader fallback): keeps the bucket
  dependency alive and forces dual read paths, contradicting the #1148
  cutover.
