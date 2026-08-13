# Feature Specification: GET /api/task-groups/{id}

| Field      | Value                                                        |
|------------|--------------------------------------------------------------|
| Feature    | Task-group rollup HTTP route                                 |
| Status     | In Progress                                                  |
| Created    | 2026-08-08                                                   |
| Owner      | Platform Engineering                                         |
| Route      | `GET /api/task-groups/{id}`                                  |
| Auth scope | `read`                                                       |
| Module     | `lore-api/src/api/routes/tasks/task-group.ts` (`taskGroupRoute`) |

GET /api/task-groups/{id} lists every task sharing one `task_group_id`, oldest first, with a completed-over-total rollup — the progress view for a single multi-repo feature.

## Problem Statement

`lore_list_task_group` carried its own inline SELECT against `pipeline.tasks` and
a pool the MCP adapter no longer has (ADR-032), so it answered "Task groups
require PostgreSQL" on every call. The query moves server-side; the tool keeps
only the rendering.

## Interface

- **Method + path**: `GET /api/task-groups/{id}`
- **Auth**: bearer token with `read` scope (`bearerScope("read")`).

### Request — path params

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string (1–200 chars) | yes | The `task_group_id` passed as `group_id` at task creation. |

### Response

| Status | Body |
|--------|------|
| 200 | `{ group_id, total, completed, tasks: [{ id, description, task_type, status, target_repo, pr_url, created_at }] }` |
| 503 | `{ "error": "database unavailable" }` when the pool is null |
| 500 | `{ "error": "<message>" }` on a query failure |

## Behavior

1. Null pool → 503 `{ error: DB_UNAVAILABLE }`.
2. One SELECT: `id, description, task_type, status, target_repo, pr_url,
   created_at FROM pipeline.tasks WHERE task_group_id = $1 ORDER BY created_at`.
3. `completed` counts rows whose status is `merged` or `completed`; `total` is
   the row count.
4. An unknown group is an empty group, **not** a 404: `task_group_id` is a
   free-form correlation key, so "no rows" is indistinguishable from "never
   used". The caller decides how to present that.

## Output

200 with the rollup and the ordered task array, or the 503 / 500 envelopes.

## Dependencies & side effects

- Read-only over `pipeline.tasks`. No writes, no fan-out.

## Acceptance Criteria

The group's tasks come back with a completed-over-total rollup. ([validated by `returns the group's tasks with a completed/total rollup`](apps/lore-api/src/api/routes/tasks/task-group.test.ts#L28))

The lookup filters `pipeline.tasks` by `task_group_id`. ([validated by `queries pipeline.tasks by task_group_id`](apps/lore-api/src/api/routes/tasks/task-group.test.ts#L47))

An unknown group id returns an empty group rather than a 404. ([validated by `returns an empty group rather than a 404 for an unknown id`](apps/lore-api/src/api/routes/tasks/task-group.test.ts#L58))

A null pool returns 503 `database unavailable`. ([validated by `returns 503 when the pool is null`](apps/lore-api/src/api/routes/tasks/task-group.test.ts#L72))

The route is registered as `GET /api/task-groups/{id}`. ([implemented by](../../../apps/lore-api/src/server/build-server.ts#L109), [implemented by](../../../apps/lore-api/src/api/routes/tasks/task-group.ts#L21))

## Out of Scope

- The MCP tool's rollup line and empty-group copy — owned by [`lore_list_task_group`](../../mcp-tools/list-task-group/spec.md).
- Creating a group (`group_id` on task creation).
- Unscoped task listing — owned by `GET /api/tasks`.
