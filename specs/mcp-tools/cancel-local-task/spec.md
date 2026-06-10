# Feature Specification: cancel_local_task MCP Tool

| Field   | Value                                       |
|---------|---------------------------------------------|
| Feature | cancel_local_task MCP Tool                  |
| Status  | **Draft**                                   |
| Created | 2026-06-10                                  |
| Owner   | Platform Engineering                        |
| Tool    | `cancel_local_task`                         |
| Module  | Pipeline (`runner.local.ts`)                |
| Scope   | local                                       |

## Problem Statement

A developer who started a background local task needs to stop it and reclaim the
disk used by its worktree. `cancel_local_task` kills the task's process, marks it
failed, and removes the worktree.

## Interface

Registered via `server.tool` ([registration](../../../mcp-server/src/mcp/tools/local-runner-tools.local.ts#L91)).

- **name**: `cancel_local_task`
- **description** (verbatim): *"Cancel a running local background task and clean
  up its worktree."*

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `task_id` | string | yes | — | Task ID to cancel. |

## Behavior

1. Call `cancelLocalTask(task_id)`
   ([handler](../../../mcp-server/src/features/pipeline/runner.local.ts#L621)):
   1. Read `~/.lore/local-tasks.json` and find the task by `taskId`.
   2. When not found, return `{cancelled: false, error: "Task not found"}`.
   3. When found but `status !== "running"`, return
      `{cancelled: false, error: "Task is <status>"}`.
   4. Otherwise `process.kill(pid, "SIGTERM")` (ignore if already dead), set
      `status = "failed"`, `error = "Cancelled by user"`, persist; `git worktree
      remove --force` (best effort); fire-and-forget `updateTaskViaAPI(…,
      "cancelled")`; return `{cancelled: true}`.
2. Map the result to text: `"Task {task_id} cancelled. Worktree cleaned up."` when
   `cancelled`, else `"Could not cancel: {error}"`.
3. Any thrown error is caught and returned as `"Error: {message}"`.

> **Trust boundary**: registered only in the local MCP server (`*.local.ts`); the
> handler operates on the local `~/.lore` registry and worktrees, absent on GKE.

## Output

A single MCP text content block: the success text, `"Could not cancel: {error}"`,
or `"Error: {message}"`. **Never throws**.

## Dependencies & side effects

- `cancelLocalTask` reads/rewrites `~/.lore/local-tasks.json`.
- `process.kill(pid, "SIGTERM")`; `git worktree remove --force` (best effort).
- Fire-and-forget `POST /api/task` status update.

## Acceptance Criteria

Cancelling an unknown task id reports it as not found without claiming success.
([validated by `returns not-found for an unknown task id with no local registry`](../../../mcp-server/src/features/pipeline/runner.local.test.ts#L262))

The SIGTERM kill, worktree removal, and not-running short-circuit are exercised
only end-to-end. *(untested: those branches require a populated
`~/.lore/local-tasks.json` at a module-load-fixed path plus a live PID and a real
worktree; not reachable without mocking `fs`/`process.kill`/`child_process`,
which the no-mocks convention forbids. The not-found branch is covered above.)*

## Out of Scope

- Starting a task — [`run_task_locally`](../run-task-locally/spec.md).
- Stale-task cleanup (`cleanupStaleTasks`).
