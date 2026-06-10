# Feature Specification: get_task_logs Tool

| Field    | Value                  |
|----------|------------------------|
| Feature  | get_task_logs          |
| Status   | **Draft**              |
| Created  | 2026-06-10             |
| Owner    | Platform Engineering   |
| Tool     | `get_task_logs`        |
| Module   | mcp-server (pipeline)  |
| Scope    | shared                 |

## Problem Statement

While a task runs (and after it finishes) the developer wants its raw
execution output without opening the GKE console or a GCS bucket. Polling
should be incremental — only the bytes after a known offset — and the
response should say whether the task has finished so a poller can stop.

## Solution

A `get_task_logs` MCP tool that resolves the task to find its repo, then
reads `<repo>/<task_id>/output.log`: in GKE mode directly from the GCS log
bucket (slicing from `offset`, returning `{logs, next_offset, complete}`);
in stdio mode by proxying to `GET /api/task-logs`. A missing log object
returns empty logs with `complete` derived from the task status.

- IMPLEMENTED_BY: registration + handler — [`pipeline-tools.ts#L344`](../../../mcp-server/src/mcp/tools/pipeline-tools.ts#L344)
- IMPLEMENTED_BY: task lookup — [`pipeline.ts#L35`](../../../mcp-server/src/features/pipeline/pipeline.ts#L35)

## Acceptance Criteria

1. The bytes after `offset` are returned with the new `next_offset` and a `complete` flag derived from task status. (untested: the GCS download + slice is inline in the handler closure against `@google-cloud/storage`, with no injectable bucket seam — live-IO)
2. A missing log object returns empty logs and a `complete` flag from the task status. (untested: same GCS `file.exists()` live-IO path, not extracted)
3. An unknown task id returns a `Task not found` message. (untested: gated on `getTask` against a live pool inside the handler closure)

## Out of Scope

- Scheduled batch-job (CronJob) logs (covered by `get_job_logs`).
- Log retention / bucket lifecycle (infra concern).
