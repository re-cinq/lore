# Feature Specification: list_pipeline_tasks Tool

| Field    | Value                  |
|----------|------------------------|
| Feature  | list_pipeline_tasks    |
| Status   | **Draft**              |
| Created  | 2026-06-10             |
| Owner    | Platform Engineering   |
| Tool     | `list_pipeline_tasks`  |
| Module   | mcp-server (pipeline)  |
| Scope    | shared                 |

## Problem Statement

Operators need a quick roster of recent pipeline tasks — optionally
narrowed to a single status (pending, running, failed, …) — newest first,
with a total count, without writing SQL or knowing the storage backend.
An invalid status must fail loudly rather than silently returning
everything.

## Solution

A `list_pipeline_tasks` MCP tool that, in DB mode, validates the status
against the known set and calls the shared `listTasks` CRUD (which selects
the summary columns ordered by `created_at DESC` with a clamped limit, plus
a count query) returning `{tasks, total}`; in stdio mode it proxies to
`GET /api/tasks`.

- IMPLEMENTED_BY: registration — [`pipeline-tools.ts#L131`](../../../mcp-server/src/mcp/tools/pipeline-tools.ts#L131)
- IMPLEMENTED_BY: handler wrapper — [`pipeline.ts#L36`](../../../mcp-server/src/features/pipeline/pipeline.ts#L36)
- IMPLEMENTED_BY: shared CRUD — [`pipeline-tasks.ts#L117`](../../../shared/src/pipeline-tasks.ts#L117)

## Acceptance Criteria

1. With no filter, all tasks are returned alongside a total count. ([validated by `returns all rows with a total count when no status filter is given`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L42))
2. With a status filter, only matching rows and their total are returned. ([validated by `returns the filtered rows and matching total when a status is given`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L53))
3. An invalid status string is rejected with the list of valid values. (untested: the status allowlist check is inline in the handler closure and not separately exported)

## Out of Scope

- Single-task detail + timeline (covered by `get_pipeline_status`).
- Group-scoped listing (covered by `list_task_group`).
- Pending-only local-claim view (covered by `list_pending_tasks`).
