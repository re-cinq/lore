# Feature Specification: lore_complete_task MCP Tool

| Field   | Value                                  |
|---------|----------------------------------------|
| Feature | lore_complete_task MCP Tool                 |
| Status  | In Progress                            |
| Created | 2026-06-10                             |
| Owner   | Platform Engineering                   |
| Tool    | `lore_complete_task`                        |
| Module  | Pipeline (`features/pipeline/tasks.ts`)|
| Scope   | shared                                 |

`lore_complete_task` marks a claimed running spec-task as completed and reports which dependent tasks that completion newly unblocks, so the caller can pick up the next unit of work without a full readiness scan.

## Problem Statement

When an agent finishes a claimed (`running`) spec-task, that completion may
unblock downstream tasks whose only remaining dependency was the one just
finished. `lore_complete_task` records the completion and reports exactly which
dependent tasks are now ready, so the caller can immediately pick up the next
unit of work without re-running a full readiness scan.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L317)).

- **name**: `lore_complete_task`
- **description** (verbatim):

```text
Marks a claimed ('running') spec-task as 'completed' and returns which dependents are now unblocked. (DB-only) Only 'running' tasks can be completed. Instead: lore_ready_tasks to pick the next item; lore_skip_task to dismiss a local notification; lore_cancel_task to cancel rather than complete.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `task_id` | string | yes | — | Task id to complete. |

## Behavior

1. `POST /api/spec-tasks/complete` with `{task_id}` via `proxyToApi`. The MCP
   adapter holds no pool (ADR-032), so the completion and the dependents scan run
   in lore-api ([`POST /api/spec-tasks/complete`](../../api-routes/spec-tasks/spec.md)).
2. The route delegates to `completeTask(pool, task_id)`
   ([handler](../../../libs/server-core/src/features/pipeline/tasks.ts#L51)). It:
   1. `SELECT id, status, context_bundle, target_repo FROM pipeline.tasks WHERE id = $1`. If no row → `{ completed: false, unblocked: [] }`.
   2. If `status !== 'running'` → `{ completed: false, unblocked: [] }` (no write).
   3. `UPDATE pipeline.tasks SET status = 'completed', updated_at = now() WHERE id = $1`.
   4. Best-effort `INSERT INTO pipeline.task_events (…, 'running','completed','{}')`; a failure is swallowed.
   5. Read `spec_task_id` + `spec_slug` from `context_bundle`. If either is missing → `{ completed: true, unblocked: [] }` (skips the dependents query).
   6. Else query dependents: `pipeline.tasks` of `task_type = 'spec-task'`, same `target_repo` + `spec_slug`, `status = 'pending'`, whose `depends_on` array contains this `spec_task_id`, and for which no remaining dependency is unsatisfied (the same `NOT EXISTS` shape `lore_ready_tasks` uses).
   7. Map dependents to `"{spec_task_id}: {description}"` → `{ completed: true, unblocked }`.
3. If the response reports `completed: false`, return
   `"Could not complete task {task_id}. It may not be in 'running' state."`.
4. Otherwise build `"Task {task_id} completed."`; if `unblocked` is non-empty,
   append `"\n\nNewly unblocked tasks:\n"` + each as `"- {entry}"`. Return it.
5. **Failure** — `not_configured` → the not-configured text; `denied` → the
   denial text; `unreachable` → the `unreachableError("completing a task", detail)` text.

## Output

A single MCP text content block: the completion message (with optional unblocked
list), the not-running message, the no-pool guard, or the error message. Never
throws.

## Dependencies & side effects

- `proxyToApi` and the shared proxy error helpers.
- Server-side: `completeTask` — read + `UPDATE` on `pipeline.tasks`, a
  best-effort `INSERT` into `pipeline.task_events`, and a dependents read query.
- Env: `LORE_API_URL`, `LORE_INGEST_TOKEN`. No database handle.

## Acceptance Criteria

A non-existent task id yields `completed: false` with no unblocked entries. ([validated by `returns completed false when the task does not exist`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L187))

A task that is not in `running` state is not completed. ([validated by `returns completed false when the task is not running`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L199))

A running task is marked completed and reports no unblocked dependents when none
qualify. ([validated by `marks a running task completed and records the transition, no slug scan`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L214))

Newly unblocked dependents are returned as `spec_task_id: description`
descriptors. ([validated by `returns formatted descriptors for newly unblocked same-spec dependents`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L237))

When the completed task carries no `spec_slug`/`spec_task_id` the dependents
query is skipped. ([validated by `marks a running task completed and records the transition, no slug scan`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L214))

Newly unblocked dependents are appended to the completion message as a bullet
list. ([validated by `lore_complete_task lists the newly unblocked dependents`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L416))

A task that was not running renders the not-running message. ([validated by `lore_complete_task reports a task that was not running`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L430))

An unconfigured API yields the not-configured message rather than a PostgreSQL
message. ([validated by `every proxied pipeline tool reports a missing API configuration`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L440))

## Out of Scope

- Choosing / claiming the next unblocked task — see [`lore_ready_tasks`](../ready-tasks/spec.md) and [`lore_claim_task`](../claim-task/spec.md).
- Terminal states other than `completed` (e.g. `merged`, `failed`).
