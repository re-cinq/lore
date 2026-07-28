# Feature Specification: lore_retry_task MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_retry_task MCP Tool            |
| Status  | In Progress                    |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_retry_task`                   |
| Module  | pipeline (`pipeline-tools.ts`) |
| Scope   | shared                         |

`lore_retry_task` clones a failed or escalated task into a fresh pipeline task linked via retry_of, refusing to re-run tasks that did not fail.

## Problem Statement

A task that failed or escalated to `needs-human-help` often just needs a second
attempt with the same intent — re-typing the description, repo, and context by
hand is error-prone. Retrying must be refused for tasks that did not fail
(re-running a merged or running task would duplicate work).

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L182)).

- **name**: `lore_retry_task`
- **description** (verbatim):

```text
Re-runs a failed or escalated task by cloning it into a new pipeline task linked via retry_of. Only tasks in 'failed' or 'needs-human-help' state are retryable. (DB-only) Instead: lore_cancel_task to stop an unwanted live task rather than re-run it.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `task_id` | string | yes | — | UUID of the failed task to retry. |

## Behavior

1. **DB gate** — if `process.env.LORE_DB_HOST` is unset, return
   `"Pipeline requires PostgreSQL (LORE_DB_HOST not set)."` (no stdio proxy for retry).
2. Dynamically import `retryTask` and call `retryTask(task_id)`
   ([handler wrapper](../../../libs/server-core/src/features/pipeline/pipeline.ts#L154)).
3. **Shared CRUD** ([`retryTask`](../../../libs/shared/src/pipeline-tasks.ts#L90)):
   1. `getTask(pool, taskId)`; if `null`, throw `"Task not found"`.
   2. If `status ∉ {failed, needs-human-help}`, throw
      `"Cannot retry task in {status} state (must be failed or needs-human-help)"`.
   3. `createTask(pool, {description, taskType: task.task_type, targetRepo:
      task.target_repo, createdBy: "retry:{task.created_by}", contextBundle:
      {...task.context_bundle, retry_of: taskId}})` — re-runs the trust gate and
      inserts a fresh `pipeline.tasks` row + `pending` event.
   4. `updateTaskStatus(pool, taskId, "retried", {retried_as: newId})` on the original.
   5. Return `{task_id: newId, status: result.status, retry_of: taskId}`.
4. The handler returns `JSON.stringify(result)` (compact).
5. Any thrown error is caught and returned as `"Error retrying task: {message}"`.

## Output

A single MCP text content block — one of: the missing-DB message, the compact
`{"task_id":…,"status":…,"retry_of":…}` JSON, or `"Error retrying task: {message}"`
(wrapping `Task not found` or `Cannot retry task in {state} state …`). **Never throws.**

## Dependencies & side effects

- `retryTask` wrapper → shared `retryTask` (→ `getTask`, `createTask`, `updateTaskStatus`).
- DB tables: `lore.repos` (trust gate on the new task), `pipeline.tasks`
  (read original, insert new, mark original `retried`), `pipeline.task_events`
  (the new task's `pending` event + the original's `retried` event).
- Env: `LORE_DB_HOST` (gate only — no proxy path).

## Acceptance Criteria

A failed task spawns a new linked task and returns the new id alongside the
original via `retry_of`.
([validated by `creates a linked task when the original is failed`](apps/mcp-server/src/features/pipeline/pipeline-crud.test.ts#L113))

A task that is not in a retryable state (e.g. running) is rejected with a
`Cannot retry task in <state> state` error.
([validated by `throws cannot retry when the task is still running`](apps/mcp-server/src/features/pipeline/pipeline-crud.test.ts#L153))

A task id with no matching row is rejected with `Task not found`.
([validated by `throws task not found when no row matches`](apps/mcp-server/src/features/pipeline/pipeline-crud.test.ts#L166))

## Out of Scope

- The trust-gate re-check on the spawned task (inherited from `lore_create_pipeline_task`).
- Cancelling instead of retrying (covered by `lore_cancel_task`).
