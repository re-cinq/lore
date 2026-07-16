# Feature Specification: POST /api/task-logs

| Field      | Value                                              |
|------------|----------------------------------------------------|
| Feature    | Task log upload                                    |
| Status     | Draft                                              |
| Created    | 2026-06-10                                        |
| Owner      | Platform Engineering                             |
| Route      | `POST /api/task-logs`                             |
| Auth scope | `write` (prefix `/api/task-logs` → `write`)      |
| Module     | Logs (`api/routes/logs.ts` → `handleTaskLogs`)   |

POST /api/task-logs receives a task's captured execution output from the local runner or Job pods and persists it to a single canonical GCS object per task, which the UI's live log viewer reads back.

## Problem Statement

The local task runner and the claude-runner Job pods produce a stream of
execution output that the web UI's live log viewer needs to read back. The
runner POSTs the captured output here; the handler persists it to a single
canonical GCS object per task (`{repo}/{task_id}/output.log`). The companion
`GET /api/task-logs` (separate handler) reads slices back from the same object.

## Interface

Registered as `exact("/api/task-logs", "POST")` →
`handleTaskLogs(req, res)`
([registration](../../../apps/mcp-server/src/api/routes/index.ts#L66),
[handler](../../../apps/mcp-server/src/api/routes/logs.ts#L4)). The pool is **not**
passed to this handler — it takes only `(req, res)`.

- **Method + path**: `POST /api/task-logs`.
- **Auth scope**: `write`. No `SCOPE_OVERRIDES` match; first `ROUTE_SCOPES` prefix
  is `/api/task-logs` → `"write"`
  ([scope map](../../../apps/mcp-server/src/api/routes/auth.ts#L50)). Note the
  `/api/task-logs` entry precedes the `/api/task` entry as a longer prefix is
  checked, but `startsWith` order in the map puts `/api/task` (`task`) earlier —
  the GET sibling shares `write`. Rate-limit bucket `task` (the URL starts with
  `/api/task`), 60/min.
- **Body**: JSON `{ task_id, repo, logs }` — all three required (truthy).

### Response

| Status | Body                          | When                              |
|--------|-------------------------------|-----------------------------------|
| 200    | `{ ok: true }`                | Logs saved to GCS.                |
| 400    | `{ error: "missing fields" }` | Any of `task_id`/`repo`/`logs` falsy. |
| 500    | `{ error: <message> }`        | JSON parse error or GCS throw.    |

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

The companion read returns empty for a missing object. ([validated by `returns empty and incomplete when the log file does not exist`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L118))

The companion read returns the slice from `offset` for an existing object. ([validated by `returns a slice from offset when the file exists`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L127))

The companion read returns 500 on a GCS failure. ([validated by `returns 500 when storage throws`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L141))

A `task`-scoped token that lacks `write` is rejected 403 on both the POST upload and the GET read, before the handler runs. ([validated by `task-logs.test.ts:70`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L70), [validated by `task-logs.test.ts:150`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L150))

The companion read resolves `repo` from `task_id` via the pool when `repo` is omitted, and returns 503 when no pool can resolve it. ([validated by `task-logs.test.ts:106`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L106), [validated by `task-logs.test.ts:98`](apps/lore-api/src/api/routes/tasks/task-logs.test.ts#L98))

The live-GCS save body (real bucket I/O, resumable flag, contentType) is exercised only against a real bucket. *(untested: real `@google-cloud/storage` network I/O has no unit seam beyond the mocked save call already asserted above.)*

## Out of Scope

- `GET /api/task-logs` full spec (covered here only as the companion read; handler `handleGetTaskLogs`).
- `GET /api/job-run-logs` (separate handler, `__job_runs__/` keyspace).
- GCS bucket provisioning / IAM (terraform).
