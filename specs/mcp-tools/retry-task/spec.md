# Feature Specification: lore_retry_task MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_retry_task MCP Tool            |
| Status  | In Progress                    |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_retry_task`                   |
| Module  | pipeline (`pipeline/retry-task.ts`) |
| Scope   | shared                         |

`lore_retry_task` clones a failed or escalated task into a fresh pipeline task linked via retry_of, refusing to re-run tasks that did not fail.

## Problem Statement

A task that failed or escalated to `needs-human-help` often just needs a second
attempt with the same intent — re-typing the description, repo, and context by
hand is error-prone. Retrying must be refused for tasks that did not fail
(re-running a merged or running task would duplicate work).

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/transport/tools/pipeline/retry-task.ts)).

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

1. `POST /api/task` with `{action: "retry", task_id}` via `proxyToApi`. The MCP
   adapter holds no pool (ADR-032), so the clone runs in lore-api
   ([`POST /api/task`](../../api-routes/task-post/spec.md)) under the `task` scope.
2. The route calls `retryTask(task_id)`
   ([handler wrapper](../../../libs/server-core/src/work/pipeline/pipeline.ts)).
3. **Shared CRUD** ([`retryTask`](../../../libs/shared/src/domain/pipeline-task-actions.ts#L14)):
   1. `getTask(pool, taskId)`; if `null`, throw `"Task not found"`.
   2. If `status ∉ {failed, needs-human-help}`, throw
      `"Cannot retry task in {status} state (must be failed or needs-human-help)"`.
   3. `createTask(pool, {description, taskType: task.task_type, targetRepo:
      task.target_repo, createdBy: "retry:{task.created_by}", contextBundle:
      {...task.context_bundle, retry_of: taskId}})` — re-runs the trust gate and
      inserts a fresh `pipeline.tasks` row + `pending` event.
   4. `updateTaskStatus(pool, taskId, "retried", {retried_as: newId})` on the original.
   5. Return `{task_id: newId, status: result.status, retry_of: taskId}`.
4. **Success** — the handler returns `JSON.stringify(body)` (compact).
5. **Failure** — `not_configured` → the not-configured text; `denied` → the
   denial text; a non-retriable status (the server refusing a non-retryable
   state) → `"The Lore API refused retrying a task: {detail}"`; a real outage →
   the `unreachableError("retrying a task", detail)` text.

## Output

A single MCP text content block — one of: the missing-DB message, the compact
`{"task_id":…,"status":…,"retry_of":…}` JSON, or `"Error retrying task: {message}"`
(wrapping `Task not found` or `Cannot retry task in {state} state …`). **Never throws.**

## Dependencies & side effects

- `proxyToApi` + `notConfiguredError` / `deniedError` / `unreachableError`.
- Server-side: shared `retryTask` (→ `getTask`, `createTask`, `updateTaskStatus`)
  over `lore.repos` (trust gate on the new task), `pipeline.tasks` (read original,
  insert new, mark original `retried`) and `pipeline.task_events`.
- Env: `LORE_API_URL`, `LORE_INGEST_TOKEN`. No database handle.

## Acceptance Criteria

An `implementation-loop` task is refused regardless of its status, with a message directing the user to remove the `lore:blocked` label from the issue instead of retrying.
([validated by `refuses an implementation-loop task and mentions removing lore:blocked`](libs/shared/src/domain/pipeline-tasks.retry-loop.test.ts#L16))

When an `implementation-loop` task is refused, no INSERT or UPDATE is issued to the database — the guard fires before any write.
([validated by `leaves the task unchanged — no INSERT or UPDATE issued`](libs/shared/src/domain/pipeline-tasks.retry-loop.test.ts#L31))

A failed task spawns a new linked task and returns the new id alongside the
original via `retry_of`.
([validated by `creates a linked task when the original is failed`](apps/mcp-server/src/work/pipeline/pipeline-crud.test.ts#L105))

A task that is not in a retryable state (e.g. running) is rejected with a
`Cannot retry task in <state> state` error.
([validated by `throws cannot retry when the task is still running`](apps/mcp-server/src/work/pipeline/pipeline-crud.test.ts#L169))

A task whose type has since been retired is rejected with that type's removal
message and where its work goes now, so a row left behind by a retired line
cannot be re-run into a line that no longer exists.
([validated by `throws the spec-task type was removed when retrying a task of a retired type`](apps/mcp-server/src/work/pipeline/pipeline-crud.test.ts#L145))

A task id with no matching row is rejected with `Task not found`.
([validated by `throws task not found when no row matches the task to retry`](apps/mcp-server/src/work/pipeline/pipeline-crud.test.ts#L182))

The retry action is posted to `/api/task` and the new task is returned
verbatim. ([validated by posts the retry action for t1 and returns the new task t2](apps/mcp-server/src/transport/tools/pipeline/retry-task.test.ts#L24))

An unconfigured API yields the not-configured message rather than a PostgreSQL
message. ([validated by reports a missing API configuration without fetching](apps/mcp-server/src/transport/tools/pipeline/retry-task.test.ts#L39))

## Out of Scope

- The trust-gate re-check on the spawned task (inherited from `lore_create_pipeline_task`).
- Cancelling instead of retrying (covered by `lore_cancel_task`).
