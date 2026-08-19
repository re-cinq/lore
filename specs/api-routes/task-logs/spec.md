# Feature Specification: POST /api/task-logs

| Field      | Value                                          |
| ---------- | ---------------------------------------------- |
| Feature    | Task log upload                                |
| Status     | In Progress                                    |
| Created    | 2026-06-10                                     |
| Owner      | Platform Engineering                           |
| Route      | `POST /api/task-logs`                          |
| Auth scope | `write` (prefix `/api/task-logs` → `write`)    |
| Module     | Logs (`api/routes/logs.ts` → `handleTaskLogs`) |

POST /api/task-logs receives a task's captured execution output from the local runner or Job pods and persists it to a single canonical GCS object per task, which the UI's live log viewer reads back.

## Problem Statement

The local task runner produces a stream of execution output that readers
(the `lore_get_task_logs` MCP tool) need to read back. The runner POSTs the
captured output here; the handler persists it to a single canonical GCS object
per task (`{repo}/{task_id}/output.log`). Cluster runs do NOT write this
object — their output streams to `pipeline.agent_run_turns` via
`/api/agent-events` — so the companion `GET /api/task-logs` (separate handler)
reads the turn store first, flattening each turn envelope to one NDJSON line,
and falls back to the GCS object only when the task has no turns. `offset` /
`next_offset` are UTF-16 code-unit offsets into the flattened transcript (or
the GCS object body on the fallback path), and the read is capped at
`LOG_SLICE_MAX` (256 Ki code units) per request; `complete` is true only when
the task is in a settled status (not
pending/queued/running/running-local/awaiting_approval) and no content remains
past the returned slice. Turn-store responses also carry an opaque `cursor`
resume hint; a client that echoes it alongside the returned `next_offset` lets
the next poll seek straight to the last consumed row instead of re-paging the
whole prefix (#1307). The cursor is optional and untrusted — absent, foreign,
malformed, or inconsistent cursors fall back to the full re-scan. One caveat:
a resumed poll stays on the turn-store path even when the rows have since been
pruned by retention, so a client whose task also has a GCS object reaches the
fallback by dropping the cursor.

## Interface

Registered as `exact("/api/task-logs", "POST")` →
`handleTaskLogs(req, res)`
([registration](../../../apps/lore-api/src/server/build-server.ts#L96),
[handler](../../../apps/lore-api/src/api/routes/tasks/task-logs.ts#L30)). The pool is **not**
passed to this handler — it takes only `(req, res)`.

- **Method + path**: `POST /api/task-logs`.
- **Auth scope**: `write`. No `SCOPE_OVERRIDES` match; first `ROUTE_SCOPES` prefix
  is `/api/task-logs` → `"write"`
  ([scope map](../../../apps/lore-api/src/api/routes/tasks/task-logs.ts#L35)). Note the
  `/api/task-logs` entry precedes the `/api/task` entry as a longer prefix is
  checked, but `startsWith` order in the map puts `/api/task` (`task`) earlier —
  the GET sibling shares `write`. Rate-limit bucket `task` (the URL starts with
  `/api/task`), 60/min.
- **Body**: JSON `{ task_id, repo, logs }` — all three required (truthy).

### Response

| Status | Body                          | When                                  |
| ------ | ----------------------------- | ------------------------------------- |
| 200    | `{ ok: true }`                | Logs saved to GCS.                    |
| 400    | `{ error: "missing fields" }` | Any of `task_id`/`repo`/`logs` falsy. |
| 500    | `{ error: <message> }`        | JSON parse error or GCS throw.        |

## Behavior

1. Read the raw body with `readBody`; `JSON.parse` it inside the try (parse error
   → step 5).
2. Destructure `{ task_id, repo, logs }`. If any is falsy →
   `400 { error: "missing fields" }`.
3. Dynamically `import("@google-cloud/storage")`; construct
   `new Storage().bucket(process.env.LORE_LOG_BUCKET || "lore-task-logs")`.
4. `bucket.file("${repo}/${task_id}/output.log").save(logs, { resumable: false,
   contentType: "text/plain" })` — overwrites the canonical per-task object.
   Return `200 { ok: true }`.
5. Any thrown error → `500 { error: err.message }`.

The GCS object key is deterministic (`{repo}/{task_id}/output.log`), so repeated
POSTs replace the prior upload rather than appending — the runner sends the full
buffer each time.

## Output

`200 { ok: true }` on success; `400 { error: "missing fields" }` (verbatim) on a
missing field; `500 { error: <message> }` on parse or GCS failure. Pure write —
the body is not echoed.

## Dependencies & side effects

- Handler `handleTaskLogs`; `readBody`, `json`; `@google-cloud/storage` (dynamic
  import).
- GCS write: bucket `LORE_LOG_BUCKET` (default `lore-task-logs`), object
  `{repo}/{task_id}/output.log`.
- Env: `LORE_LOG_BUCKET`. No DB, no GitHub. Auth via the dispatcher
  (`pipeline.api_tokens`, `write` scope).

## Acceptance Criteria

A missing field returns 400. ([validated by `returns 400 when fields are missing`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L52))

A complete body saves the logs to GCS and returns `{ ok: true }`. ([validated by `saves logs to storage`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L57))

A GCS failure returns 500. ([validated by `returns 500 when storage throws`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L64))

The companion read returns 400 without `task_id`/`repo`. ([validated by `returns 400 when task_id is missing`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L90))

The companion read returns empty for a missing object. ([validated by `returns empty and incomplete when the log file does not exist`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L153))

The companion read returns the slice from `offset` for an existing object. ([validated by `returns a slice from offset when the file exists`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L162))

The companion read returns 500 on a GCS failure. ([validated by `returns 500 when storage throws`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L176))

A `task`-scoped token that lacks `write` is rejected 403 on both the POST upload and the GET read, before the handler runs. ([validated by `task-logs.test.ts:70`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L70), [validated by `task-logs.test.ts:182`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L185))

The companion read resolves `repo` from `task_id` via the pool when `repo` is omitted, and returns 503 when no pool can resolve it. ([validated by `task-logs.test.ts:140`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L143), [validated by `task-logs.test.ts:98`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L98))

The companion read returns a task's `pipeline.agent_run_turns` rows flattened to one NDJSON envelope line each, with `complete: true` when the task is settled, without touching GCS. ([validated by `returns flattened turn envelopes with complete true when the task is finished`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L198))

The companion read returns `complete: false` for the turns of a task still in an active status. ([validated by `returns complete false for turns of a task still running`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L219))

The companion read slices the flattened transcript from `offset` (UTF-16 code units). ([validated by `returns the slice from offset into the flattened transcript`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L231))

The companion read caps one response at `LOG_SLICE_MAX` code units, stops fetching turn pages once the cap is filled, and reports `complete: false` while content remains. ([validated by `caps the slice at LOG_SLICE_MAX and stops fetching further pages`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L252))

A task with no turns falls back to the GCS object, and a settled task whose object is also missing reports `complete: true` so pollers stop. ([validated by `falls back to GCS with complete true when a finished task has no turns`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L278))

The turn read pages through the id cursor, so a transcript larger than one page flattens whole. ([validated by `pages the cursor across a transcript larger than one page`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L291))

Turns whose task row no longer exists count as settled — the row can only be gone, never transition — so their read reports `complete: true`. ([validated by `returns complete true for turns whose task row is gone`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L314))

A GCS hit reports `complete` from the task's status when a pool is available — the local runner re-POSTs the full buffer while still running, so an existing object does not mean the run ended; without a pool the legacy always-complete read stands. ([validated by `returns complete false for a GCS hit while the local task still runs`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L323))

Every turn-store response carries an opaque `cursor` (`<taskId>:<rowId>:<chars>`: the last fully consumed row and the flattened char count through its end); a poll that passes the previous response's `cursor` together with its `next_offset` resumes the read at that row instead of re-paging the whole prefix, so draining a transcript is O(rows) instead of O(rows²). ([validated by `resumes from the returned cursor without re-reading the prefix`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L361))

When the `LOG_SLICE_MAX` cap lands exactly on a row boundary the cursor names that row, and the resumed poll re-reads nothing. ([validated by `mints the cursor at the row boundary when the cap lands exactly on it`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L388))

A resumed poll that finds no new rows echoes the incoming cursor unchanged and stays on the turn-store path, so an idle tail-follow poll costs O(1) reads and never falls into the GCS fallback. ([validated by `echoes the cursor unchanged when no new rows arrived`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L424))

A cursor minted for a different task is ignored and the read falls back to the full authoritative scan from row id 0. ([validated by `ignores a cursor minted for a different task`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L449))

A cursor that does not parse as `<taskId>:<rowId>:<chars>` is ignored. ([validated by `ignores a garbage cursor`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L466))

A cursor whose char count exceeds the requested offset is ignored — re-polling from an earlier offset without a matching cursor is the documented self-heal path. ([validated by `ignores a cursor whose char count exceeds the offset`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L483))

At offset 0 every cursor is ignored, so a forged cursor cannot silently drop leading rows from a full read. ([validated by `ignores any cursor at offset zero`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L500))

A resumed offset must sit at the cursor's boundary or strictly inside the first row after it; otherwise the cursor is stale or forged and the read restarts as a full scan from row id 0. ([validated by `rescans when the offset is not inside the first resumed row`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L517))

A cursor pointing past every stored row while the offset sits past its boundary restarts as a full scan rather than trusting the client's boundary; at the boundary itself (`offset == chars`) the pair is trusted as-is, since server-minted cursors are self-consistent and verifying the boundary would take the very prefix scan the resume avoids. ([validated by `rescans when the cursor points past every stored row`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L534))

Turn row ids are string-encoded bigints and round-trip through the cursor without `Number` narrowing. ([validated by `round-trips row ids past the max safe integer without narrowing`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L551))

A cursor whose row id exceeds the PG bigint range is rejected at parse time and falls back to the full re-scan, instead of 500ing inside the `id > $2::bigint` cast. ([validated by `rejects a cursor whose row id exceeds the PG bigint range`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L579))

The live-GCS save body (real bucket I/O, resumable flag, contentType) is exercised only against a real bucket. _(untested: real `@google-cloud/storage` network I/O has no unit seam beyond the mocked save call already asserted above.)_

## Out of Scope

- `GET /api/task-logs` full behavior spec beyond the acceptance criteria above (the turn-store read + GCS fallback are covered as the companion read; handler `taskLogsGetRoute`).
- The local runner's write-side cutover to the turn store (issue #1295) — until it lands, the POST upload and the GCS fallback read stay.
- `GET /api/job-run-logs` (separate handler, `__job_runs__/` keyspace).
- GCS bucket provisioning / IAM (terraform).
