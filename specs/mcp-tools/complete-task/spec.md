# Feature Specification: lore_complete_task MCP Tool

| Field   | Value                                  |
|---------|----------------------------------------|
| Feature | lore_complete_task MCP Tool                 |
| Status  | **Draft**                              |
| Created | 2026-06-10                             |
| Owner   | Platform Engineering                   |
| Tool    | `lore_complete_task`                        |
| Module  | Pipeline (`features/pipeline/tasks.ts`)|
| Scope   | shared                                 |

## Problem Statement

When an agent finishes a claimed (`running`) spec-task, that completion may
unblock downstream tasks whose only remaining dependency was the one just
finished. `lore_complete_task` records the completion and reports exactly which
dependent tasks are now ready, so the caller can immediately pick up the next
unit of work without re-running a full readiness scan.

## Interface

Registered via `server.tool` ([registration](../../../apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L317)).

- **name**: `lore_complete_task`
- **description** (verbatim): *"Mark a spec-task as completed and report any
  newly unblocked tasks."*

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `task_id` | string | yes | — | UUID of the pipeline task to complete. |

## Behavior

1. `getPool()`. If null, return `"lore_complete_task requires PostgreSQL (LORE_DB_HOST not set)."`.
2. Delegate to `completeTask(pool, task_id)`
   ([handler](../../../apps/mcp-server/src/features/pipeline/tasks.ts#L162)). It:
   1. `SELECT id, status, context_bundle, target_repo FROM pipeline.tasks WHERE id = $1`. If no row → `{ completed: false, unblocked: [] }`.
   2. If `status !== 'running'` → `{ completed: false, unblocked: [] }` (no write).
   3. `UPDATE pipeline.tasks SET status = 'completed', updated_at = now() WHERE id = $1`.
   4. Best-effort `INSERT INTO pipeline.task_events (…, 'running','completed','{}')`; a failure is swallowed.
   5. Read `spec_task_id` + `spec_slug` from `context_bundle`. If either is missing → `{ completed: true, unblocked: [] }` (skips the dependents query).
   6. Else query dependents: `pipeline.tasks` of `task_type = 'spec-task'`, same `target_repo` + `spec_slug`, `status = 'pending'`, whose `depends_on` array contains this `spec_task_id`, and for which no remaining dependency is unsatisfied (the same `NOT EXISTS` shape `lore_ready_tasks` uses).
   7. Map dependents to `"{spec_task_id}: {description}"` → `{ completed: true, unblocked }`.
3. If `result.completed` is false, return
   `"Could not complete task {task_id}. It may not be in 'running' state."`.
4. Otherwise build `"Task {task_id} completed."`; if `unblocked` is non-empty,
   append `"\n\nNewly unblocked tasks:\n"` + each as `"- {entry}"`. Return it.
5. Any thrown error → `"Error completing task: {message}"`.

## Output

A single MCP text content block: the completion message (with optional unblocked
list), the not-running message, the no-pool guard, or the error message. Never
throws.

## Dependencies & side effects

- `getPool()`, `completeTask`.
- DB: read + `UPDATE` on `pipeline.tasks`; best-effort `INSERT` into `pipeline.task_events`; a dependents read query.
- No env vars beyond the DB pool's.

## Acceptance Criteria

A non-existent task id yields `completed: false` with no unblocked entries. ([validated by `returns completed false when the task does not exist`](../../../apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L184))

A task that is not in `running` state is not completed. ([validated by `returns completed false when the task is not running`](../../../apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L192))

A running task is marked completed and reports no unblocked dependents when none
qualify. ([validated by `marks a running task completed with no unblocked dependents`](../../../apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L202))

Newly unblocked dependents are returned as `spec_task_id: description`
descriptors. ([validated by `returns formatted descriptors for newly unblocked dependents`](../../../apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L217))

When the completed task carries no `spec_slug`/`spec_task_id` the dependents
query is skipped. ([validated by `skips the dependents query when the completed task lacks slug metadata`](../../../apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L239))

The no-pool guard and the message-framing (success/unblocked-list/not-running)
run only inside the tool handler. *(untested: handler-only orchestration around
`getPool` with no unit seam; the DB logic it delegates to is covered above.)*

## Out of Scope

- Choosing / claiming the next unblocked task — see [`lore_ready_tasks`](../ready-tasks/spec.md) and [`lore_claim_task`](../claim-task/spec.md).
- Terminal states other than `completed` (e.g. `merged`, `failed`).
