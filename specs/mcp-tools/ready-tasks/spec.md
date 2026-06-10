# Feature Specification: ready_tasks MCP Tool

| Field   | Value                                  |
|---------|----------------------------------------|
| Feature | ready_tasks MCP Tool                   |
| Status  | **Draft**                              |
| Created | 2026-06-10                             |
| Owner   | Platform Engineering                   |
| Tool    | `ready_tasks`                          |
| Module  | Pipeline (`features/pipeline/tasks.ts`)|
| Scope   | shared                                 |

## Problem Statement

Once a `tasks.md` is synced (see [`sync_tasks`](../sync-tasks/spec.md)), an agent
needs to know which spec-tasks it can start *now* — i.e. those still `pending`
whose every declared dependency has already reached a terminal-success state.
`ready_tasks` answers that question for one repo so the agent (or developer)
picks the next workable item without scanning the whole backlog.

## Interface

Registered via `server.tool` ([registration](../../../mcp-server/src/mcp/tools/pipeline-tools.ts#L262)).

- **name**: `ready_tasks`
- **description** (verbatim): *"List spec-tasks that are ready to work on (all
  dependencies satisfied)."*

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `repo` | string | no | — | `owner/repo`. Auto-detected from the git remote when omitted. |

## Behavior

1. Resolve `repo || detectCurrentRepo()`. If neither yields a repo, return
   `"Could not detect repo. Specify repo parameter."`.
2. `getPool()`. If null, return `"ready_tasks requires PostgreSQL (LORE_DB_HOST not set)."`.
3. Delegate to `getReadyTasks(pool, resolvedRepo)`
   ([handler](../../../mcp-server/src/features/pipeline/tasks.ts#L85)). It runs a single query
   selecting `id, description, status, context_bundle, agent_id` from
   `pipeline.tasks` where `task_type = 'spec-task'`, `target_repo = $1`,
   `status = 'pending'`, and a correlated `NOT EXISTS` over each
   `context_bundle->'depends_on'` entry requires a matching task (same
   `spec_slug`, same repo) whose status is in (`completed`, `merged`). Ordered
   by `context_bundle->>'spec_task_id'`.
4. If the result is empty, return
   `"No ready tasks. All tasks are either completed, claimed, or blocked by dependencies."`.
5. Otherwise format each row as `"- **{spec_task_id}** ({id}): {description}"` and
   return `"## Ready tasks\n\n{lines joined by newline}"`.
6. Any thrown error → `"Error fetching ready tasks: {message}"`.

## Output

A single MCP text content block: the `## Ready tasks` markdown list, the
"No ready tasks" message, a guard message, or the error message. Never throws.

## Dependencies & side effects

- `detectCurrentRepo()`, `getPool()`, `getReadyTasks`.
- DB: read-only over `pipeline.tasks`.
- No env vars beyond the DB pool's.

## Acceptance Criteria

The dependency query returns the rows it produces, filtered to pending
spec-tasks with satisfied dependencies. ([validated by `returns the rows the dependency query produces`](../../../mcp-server/src/features/pipeline/tasks-db.test.ts#L107))

When nothing qualifies the handler returns an empty list. ([validated by `returns an empty list when no tasks are ready`](../../../mcp-server/src/features/pipeline/tasks-db.test.ts#L123))

The repo-detection / no-pool guards, the empty-result message, and the markdown
list framing run only inside the tool handler. *(untested: handler-only
orchestration around `detectCurrentRepo`/`getPool` with no unit seam; the query
layer is covered above.)*

## Out of Scope

- Claiming a returned task — see [`claim_task`](../claim-task/spec.md).
- Marking tasks done / unblocking — see [`complete_task`](../complete-task/spec.md).
- The dependency-satisfaction SQL's exact `merged`-state semantics beyond the row set it returns.
