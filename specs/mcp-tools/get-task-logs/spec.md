# Feature Specification: lore_get_task_logs MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_get_task_logs MCP Tool         |
| Status  | In Progress                    |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_get_task_logs`                |
| Module  | pipeline (`pipeline-tools.ts`) |
| Scope   | shared                         |

`lore_get_task_logs` fetches a pipeline task's execution transcript by id — NDJSON turn envelopes when the task has recorded agent turns, the raw captured output otherwise — supporting incremental polling from a UTF-16 code-unit offset and reporting whether the task has finished so a poller knows when to stop.

## Problem Statement

While a task runs (and after it finishes) the developer wants its execution
transcript without opening the GKE console or the web UI. Polling should be
incremental — only the code units after a known offset — and the response should
say whether the task has finished so a poller can stop.

## Interface

Registered via `server.tool` ([registration + handler](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L671)).

- **name**: `lore_get_task_logs`
- **description** (verbatim):

```text
Fetches one pipeline task's execution transcript (by UUID), returning {logs, next_offset, complete, cursor?}. Tasks with recorded agent turns return NDJSON — one {source, event} stream-json envelope per line from the turn store; tasks with no recorded turns fall back to the raw captured output. Responses may be capped: pass next_offset back as offset (and cursor back verbatim, when present) and poll until complete is true. Instead: lore_get_job_logs (job_name + run_id) for scheduled CronJob run logs.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `task_id` | string | yes | — | UUID of the pipeline task. |
| `offset` | number | no | `0` | UTF-16 code-unit offset (not bytes) into the flattened transcript; pass previous `next_offset` to poll incrementally. |
| `cursor` | string | no | — | Opaque resume cursor from the previous response; pass it back only together with that response's `next_offset` as `offset`. Omit it when reading from any other offset. |

## Behavior

1. **Task lookup** — `getTask(task_id)` ([task lookup](../../../libs/server-core/src/features/pipeline/pipeline.ts#L41));
   if `null`, return `"Task not found: {task_id}"`. `repo = task.target_repo`.
2. **Transport branch on `process.env.LORE_DB_HOST`:**
   - **stdio mode (no `LORE_DB_HOST`)** — if `LORE_API_URL` + `LORE_INGEST_TOKEN`
     are set, `GET {LORE_API_URL}/api/task-logs?task_id&repo&offset` with bearer
     token; on 2xx return the raw body (`JSON.stringify(await res.json())`).
     Otherwise (or non-2xx) return `"Task logs require LORE_API_URL."`
   - **GKE mode (`LORE_DB_HOST` set)** — direct GCS read (below).
3. **GCS read** — dynamically import `@google-cloud/storage`; bucket =
   `process.env.LORE_LOG_BUCKET || "lore-task-logs"`; object key
   `{repo}/{task_id}/output.log`.
   - `file.exists()` false → return `{logs: "", next_offset: 0, complete: task.status !== 'running'}`.
   - Otherwise `file.download()`, `full = content.toString("utf-8")`,
     `sliced = full.substring(offset)`; return
     `{logs: sliced, next_offset: full.length, complete: task.status !== 'running'}`.
   - A GCS error is caught and returned as `"Error reading logs: {message}"`.
4. Any outer thrown error is caught and returned as `"Error: {message}"`.

## Output

A single MCP text content block — one of: `"Task not found: {id}"`, the proxied
body, `"Task logs require LORE_API_URL."`, the compact
`{"logs":…,"next_offset":…,"complete":…}` JSON, `"Error reading logs: {message}"`,
or `"Error: {message}"`. **Never throws.**

## Dependencies & side effects

- `getTask` (resolves `target_repo` + status). Read-only.
- GCS bucket `LORE_LOG_BUCKET` (default `lore-task-logs`), object
  `{repo}/{task_id}/output.log`.
- Env: `LORE_DB_HOST` (transport switch), `LORE_API_URL`, `LORE_INGEST_TOKEN`
  (proxy path), `LORE_LOG_BUCKET`.
- GET `/api/task-logs` on the GKE server (stdio path).

## Acceptance Criteria

The registered tool description is byte-identical to this spec's verbatim description block, so the two cannot drift apart silently.
([validated by `matches the spec's verbatim description block`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L459))

The content after `offset` is returned with the new `next_offset` and a
`complete` flag derived from task status.
*(untested: the GCS download + slice is inline in the handler closure against `@google-cloud/storage`, with no injectable bucket seam — live-IO.)*

A missing log object returns empty logs and a `complete` flag from the task status.
*(untested: same GCS `file.exists()` live-IO path, not extracted.)*

An unknown task id returns a `Task not found` message.
*(untested: gated on `getTask` against a live pool inside the handler closure.)*

## Out of Scope

- Scheduled batch-job (CronJob) logs (covered by `lore_get_job_logs`).
- Log retention / bucket lifecycle (infra concern).
