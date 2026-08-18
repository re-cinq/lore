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
past the returned slice.

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

The companion read returns empty for a missing object. ([validated by `returns empty and incomplete when the log file does not exist`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L144))

The companion read returns the slice from `offset` for an existing object. ([validated by `returns a slice from offset when the file exists`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L153))

The companion read returns 500 on a GCS failure. ([validated by `returns 500 when storage throws`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L167))

A `task`-scoped token that lacks `write` is rejected 403 on both the POST upload and the GET read, before the handler runs. ([validated by `task-logs.test.ts:70`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L70), [validated by `task-logs.test.ts:176`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L176))

The companion read resolves `repo` from `task_id` via the pool when `repo` is omitted, and returns 503 when no pool can resolve it. ([validated by `task-logs.test.ts:134`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L134), [validated by `task-logs.test.ts:98`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L98))

The companion read returns a task's `pipeline.agent_run_turns` rows flattened to one NDJSON envelope line each, with `complete: true` when the task is settled, without touching GCS. ([validated by `returns flattened turn envelopes with complete true when the task is finished`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L189))

The companion read returns `complete: false` for the turns of a task still in an active status. ([validated by `returns complete false for turns of a task still running`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L209))

The companion read slices the flattened transcript from `offset` (UTF-16 code units). ([validated by `returns the slice from offset into the flattened transcript`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L221))

The companion read caps one response at `LOG_SLICE_MAX` code units, stops fetching turn pages once the cap is filled, and reports `complete: false` while content remains. ([validated by `caps the slice at LOG_SLICE_MAX and stops fetching further pages`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L241))

A task with no turns falls back to the GCS object, and a settled task whose object is also missing reports `complete: true` so pollers stop. ([validated by `falls back to GCS with complete true when a finished task has no turns`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L267))

The turn read pages through the id cursor, so a transcript larger than one page flattens whole. ([validated by `pages the cursor across a transcript larger than one page`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L301))

Turns whose task row no longer exists count as settled — the row can only be gone, never transition — so their read reports `complete: true`. ([validated by `returns complete true for turns whose task row is gone`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L323))

The live-GCS save body (real bucket I/O, resumable flag, contentType) is exercised only against a real bucket. _(untested: real `@google-cloud/storage` network I/O has no unit seam beyond the mocked save call already asserted above.)_

## Out of Scope

- `GET /api/task-logs` full behavior spec beyond the acceptance criteria above (the turn-store read + GCS fallback are covered as the companion read; handler `taskLogsGetRoute`).
- The local runner's write-side cutover to the turn store (issue #1295) — until it lands, the POST upload and the GCS fallback read stay.
- `GET /api/job-run-logs` (separate handler, `__job_runs__/` keyspace).
- GCS bucket provisioning / IAM (terraform).
