# Feature Specification: lore_cancel_task MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_cancel_task MCP Tool           |
| Status  | Draft                          |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_cancel_task`                  |
| Module  | pipeline (`pipeline-tools.ts`) |
| Scope   | shared                         |

`lore_cancel_task` flips a server-side pipeline task to `cancelled` by id and best-effort stops its running GKE agent, refusing tasks that already reached a terminal merged, failed, or cancelled state.

## Problem Statement

A task that is no longer wanted — queued, running, or mid-review — must be
stoppable by id so it stops consuming agent capacity and stops producing a PR.
Cancellation must be refused for tasks that have already reached a terminal
state (merged, failed, already cancelled), where "cancel" would be meaningless
or misleading.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L163)).

- **name**: `lore_cancel_task`
- **description** (verbatim):

```text
Cancels a server-side pipeline task, flipping it to 'cancelled' and best-effort stopping any running GKE agent. (DB-only) Instead: lore_cancel_local_task to stop a task running in a local worktree; lore_retry_task to re-run a failed task rather than stop a live one. Rejected for tasks already in merged/failed/cancelled state.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `task_id` | string | yes | — | UUID of the pipeline task to cancel. |

## Behavior

1. **DB gate** — if `process.env.LORE_DB_HOST` is unset, return
   `"Pipeline requires PostgreSQL (LORE_DB_HOST not set)."` (no stdio proxy for cancel).
2. Call `cancelTask(task_id)` ([handler wrapper](../../../apps/mcp-server/src/features/pipeline/pipeline.ts#L41)).
3. **Shared CRUD** ([`cancelTask`](../../../libs/shared/src/pipeline-tasks.ts#L195)):
   1. `getTask(pool, taskId)` (SELECT row + events); if `null`, throw `"Task not found"`.
   2. If `status ∈ {merged, failed, cancelled}`, throw `"Cannot cancel task in {status} state"`.
   3. Otherwise `updateTaskStatus(pool, taskId, "cancelled", {cancelled_by: "user"})`
      — reads the old status, `UPDATE pipeline.tasks SET status='cancelled', updated_at=now()`,
      then records the transition event into `pipeline.task_events`.
   4. Return `{task_id, status: "cancelled"}`.
4. The handler returns `JSON.stringify(result)` (compact, no indent).
5. Any thrown error is caught and returned as `"Error cancelling task: {message}"`
   (this is how the `Task not found` / `Cannot cancel …` throws reach the caller).

## Output

A single MCP text content block — one of: the missing-DB message, the compact
`{"task_id":…,"status":"cancelled"}` JSON, or `"Error cancelling task: {message}"`
(wrapping `Task not found` or `Cannot cancel task in {state} state`). **Never throws.**

## Dependencies & side effects

- `cancelTask` wrapper → shared `cancelTask` (→ `getTask`, `updateTaskStatus`).
- DB tables: `pipeline.tasks` (read + status UPDATE), `pipeline.task_events`
  (the `cancelled` event with `{cancelled_by: "user"}`).
- Env: `LORE_DB_HOST` (gate only — no proxy path).

## Acceptance Criteria

A running task transitions to `cancelled` and the call returns that status.
([validated by `returns cancelled status when the task is running`](apps/mcp-server/src/features/pipeline/pipeline-crud.test.ts#L74))

A task id with no matching row is rejected with `Task not found`.
([validated by `throws task not found when no row matches`](apps/mcp-server/src/features/pipeline/pipeline-crud.test.ts#L89))

A task already in a terminal state (e.g. merged) is rejected with a
`Cannot cancel task in <state> state` error.
([validated by `throws cannot cancel when the task is already merged`](apps/mcp-server/src/features/pipeline/pipeline-crud.test.ts#L100))

## Out of Scope

- Killing the live agent process / Job pod (best-effort, handled by the
  lore-agent service).
- Retrying a cancelled or failed task (covered by `lore_retry_task`).
