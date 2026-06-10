# Feature Specification: retry_task Tool

| Field    | Value                  |
|----------|------------------------|
| Feature  | retry_task             |
| Status   | **Draft**              |
| Created  | 2026-06-10             |
| Owner    | Platform Engineering   |
| Tool     | `retry_task`           |
| Module   | mcp-server (pipeline)  |
| Scope    | shared                 |

## Problem Statement

A task that failed or escalated to `needs-human-help` often just needs a
second attempt with the same intent — re-typing the description, repo, and
context by hand is error-prone. Retrying must be refused for tasks that
did not fail (re-running a merged or running task would duplicate work).

## Solution

A `retry_task` MCP tool that, when a DB is configured, calls the shared
`retryTask` CRUD: it reads the original, refuses unless the status is
`failed` or `needs-human-help`, otherwise creates a new task carrying the
original's description / type / repo and a `retry_of` context link, marks
the original `retried`, and returns `{task_id, status, retry_of}`.

- IMPLEMENTED_BY: registration — [`pipeline-tools.ts#L182`](../../../mcp-server/src/mcp/tools/pipeline-tools.ts#L182)
- IMPLEMENTED_BY: handler wrapper — [`pipeline.ts#L111`](../../../mcp-server/src/features/pipeline/pipeline.ts#L111)
- IMPLEMENTED_BY: shared CRUD — [`pipeline-tasks.ts#L90`](../../../shared/src/pipeline-tasks.ts#L90)

## Acceptance Criteria

1. A failed task spawns a new linked task and returns the new id alongside the original via `retry_of`. ([validated by `creates a linked task when the original is failed`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L95))
2. A task that is not in a retryable state (e.g. running) is rejected with a `Cannot retry task in <state> state` error. ([validated by `throws cannot retry when the task is still running`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L114))
3. A task id with no matching row is rejected with `Task not found`. ([validated by `throws task not found when no row matches`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L124))

## Out of Scope

- The trust-gate re-check on the spawned task (inherited from
  `create_pipeline_task`).
- Cancelling instead of retrying (covered by `cancel_task`).
