# Feature Specification: get_pipeline_status Tool

| Field    | Value                  |
|----------|------------------------|
| Feature  | get_pipeline_status    |
| Status   | **Draft**              |
| Created  | 2026-06-10             |
| Owner    | Platform Engineering   |
| Tool     | `get_pipeline_status`  |
| Module   | mcp-server (pipeline)  |
| Scope    | shared                 |

## Problem Statement

After delegating a task, the caller needs to see where it stands — current
status plus the full ordered event timeline (pending → running →
pr-created → …) — by task id alone, without knowing whether the server is
local (stdio proxy) or on GKE (direct DB). A missing id must be reported
distinctly from an error.

## Solution

A `get_pipeline_status` MCP tool that, in DB mode, reads the task row and
its `pipeline.task_events` (ordered by `created_at`) via the shared
`getTask` CRUD; in stdio mode it proxies to `GET /api/task/:id`. A
not-found task returns a plain `task not found` message rather than
throwing; a found task returns the row merged with its `events` array as
formatted JSON.

- IMPLEMENTED_BY: registration — [`pipeline-tools.ts#L87`](../../../mcp-server/src/mcp/tools/pipeline-tools.ts#L87)
- IMPLEMENTED_BY: handler wrapper — [`pipeline.ts#L35`](../../../mcp-server/src/features/pipeline/pipeline.ts#L35)
- IMPLEMENTED_BY: shared CRUD — [`pipeline-tasks.ts#L107`](../../../shared/src/pipeline-tasks.ts#L107)

## Acceptance Criteria

1. A task id with no matching row resolves to null (the handler surfaces this as `task not found`). ([validated by `returns null when no task row matches the id`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L21))
2. A matching id returns the task row merged with its ordered `events` array. ([validated by `returns the task with its ordered events when the id matches`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L27))

## Out of Scope

- Live PR / CI state (covered by `get_pr_status`).
- Execution log bytes (covered by `get_task_logs`).
- Cross-task group rollups (covered by `list_task_group`).
