# Feature Specification: cancel_task Tool

| Field    | Value                  |
|----------|------------------------|
| Feature  | cancel_task            |
| Status   | **Draft**              |
| Created  | 2026-06-10             |
| Owner    | Platform Engineering   |
| Tool     | `cancel_task`          |
| Module   | mcp-server (pipeline)  |
| Scope    | shared                 |

## Problem Statement

A task that is no longer wanted — queued, running, or mid-review — must be
stoppable by id so it stops consuming agent capacity and stops producing a
PR. Cancellation must be refused for tasks that have already reached a
terminal state (merged, failed, already cancelled), where "cancel" would
be meaningless or misleading.

## Solution

A `cancel_task` MCP tool that, when a DB is configured, calls the shared
`cancelTask` CRUD: it reads the task, refuses if the status is terminal,
otherwise transitions it to `cancelled` (recording the event with
`cancelled_by: user`) and returns `{task_id, status: cancelled}`. Without
a DB it returns a configuration message.

- IMPLEMENTED_BY: registration — [`pipeline-tools.ts#L163`](../../../mcp-server/src/mcp/tools/pipeline-tools.ts#L163)
- IMPLEMENTED_BY: handler wrapper — [`pipeline.ts#L41`](../../../mcp-server/src/features/pipeline/pipeline.ts#L41)
- IMPLEMENTED_BY: shared CRUD — [`pipeline-tasks.ts#L195`](../../../shared/src/pipeline-tasks.ts#L195)

## Acceptance Criteria

1. A running task transitions to `cancelled` and the call returns that status. ([validated by `returns cancelled status when the task is running`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L66))
2. A task id with no matching row is rejected with `Task not found`. ([validated by `throws task not found when no row matches`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L77))
3. A task already in a terminal state (e.g. merged) is rejected with a `Cannot cancel task in <state> state` error. ([validated by `throws cannot cancel when the task is already merged`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L83))

## Out of Scope

- Killing the live agent process / Job pod (best-effort, handled by the
  lore-agent service).
- Retrying a cancelled or failed task (covered by `retry_task`).
