# Feature Specification: list_task_group Tool

| Field    | Value                  |
|----------|------------------------|
| Feature  | list_task_group        |
| Status   | **Draft**              |
| Created  | 2026-06-10             |
| Owner    | Platform Engineering   |
| Tool     | `list_task_group`      |
| Module   | mcp-server (pipeline)  |
| Scope    | shared                 |

## Problem Statement

Multi-repo features are coordinated as a task group (shared
`task_group_id`). To know whether the whole feature is done, the caller
needs every task in the group with its per-task status and a
completed/total rollup, without running cross-row SQL by hand.

## Solution

A `list_task_group` MCP tool that, when a pool is available, selects the
group's tasks (id, description, type, status, repo, pr_url, created_at)
ordered by `created_at`, counts those in a completed state
(`merged`/`completed`), and returns a `N/total completed` summary plus the
rows; an empty group returns a `No tasks found` message. The SQL and the
completed-count rollup are inline in the handler closure.

- IMPLEMENTED_BY: registration + handler — [`pipeline-tools.ts#L202`](../../../mcp-server/src/mcp/tools/pipeline-tools.ts#L202)
- IMPLEMENTED_BY: query body — [`pipeline-tools.ts#L214`](../../../mcp-server/src/mcp/tools/pipeline-tools.ts#L214)

## Acceptance Criteria

1. A group with tasks returns every row ordered by creation time. (untested: the group SELECT is inline in the handler closure and not exported as a pure function — testable only against a live Postgres)
2. The completed/total rollup counts only `merged`/`completed` tasks. (untested: the rollup count is inline in the handler closure and not exported)
3. A group id with no tasks returns a `No tasks found` message rather than an empty rollup. (untested: the empty-group branch is inline in the handler closure and not exported)

## Out of Scope

- Creating a group (`group_id` on `create_pipeline_task`).
- Cross-group / global listing (covered by `list_pipeline_tasks`).
