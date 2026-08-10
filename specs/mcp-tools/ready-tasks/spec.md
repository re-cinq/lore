# Feature Specification: lore_ready_tasks MCP Tool

| Field   | Value                                  |
|---------|----------------------------------------|
| Feature | lore_ready_tasks MCP Tool                   |
| Status  | In Progress                            |
| Created | 2026-06-10                             |
| Owner   | Platform Engineering                   |
| Tool    | `lore_ready_tasks`                          |
| Module  | Pipeline (`features/pipeline/tasks.ts`)|
| Scope   | shared                                 |

`lore_ready_tasks` lists the pending spec-tasks in one repo whose every declared dependency has completed, so an agent can pick the next workable item without scanning the whole backlog.

## Problem Statement

Once a `tasks.md` is synced (see [`lore_sync_tasks`](../sync-tasks/spec.md)), an agent
needs to know which spec-tasks it can start *now* — i.e. those still `pending`
whose every declared dependency has already reached a terminal-success state.
`lore_ready_tasks` answers that question for one repo so the agent (or developer)
picks the next workable item without scanning the whole backlog.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L262)).

- **name**: `lore_ready_tasks`
- **description** (verbatim):

```text
Lists spec-tasks that are 'pending' AND whose every dependency has completed — the items you can start right now. (DB-only) Spec-tasks must first be materialized with lore_sync_tasks; after picking one, lock it with lore_claim_task. Instead: lore_list_pipeline_tasks for a general status-filtered listing; lore_list_pending_tasks for unclaimed tasks across repos to run locally.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `repo` | string | no | — | `owner/repo`. Auto-detected from git remote when omitted. |

## Behavior

1. Resolve `repo || detectCurrentRepo()`. If neither yields a repo, return
   `"Could not detect repo. Specify repo parameter."`.
2. `GET /api/spec-tasks/ready?repo={resolvedRepo}` via `proxyGetApi`. The MCP
   adapter holds no pool (ADR-032), so the dependency query runs in lore-api
   ([`GET /api/spec-tasks/ready`](../../api-routes/spec-tasks/spec.md)).
3. The route delegates to `getReadyTasks(pool, repo)`
   ([handler](../../../libs/server-core/src/features/pipeline/tasks.ts#L24)). It runs a single query
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
6. **Failure** — `not_configured` → the not-configured text; `denied` → the
   denial text; `unreachable` → `"Could not fetch ready tasks from the Lore API: {detail}"`.

## Output

A single MCP text content block: the `## Ready tasks` markdown list, the
"No ready tasks" message, a guard message, or the error message. Never throws.

## Dependencies & side effects

- `detectCurrentRepo()` (client-side — the server cannot see the caller's git
  remote), `proxyGetApi`, and the shared proxy error helpers.
- Server-side: `getReadyTasks`, read-only over `pipeline.tasks`.
- Env: `LORE_API_URL`, `LORE_INGEST_TOKEN`. No database handle.

## Acceptance Criteria

The dependency query returns the rows it produces, filtered to pending
spec-tasks with satisfied dependencies. ([validated by `returns the rows the dependency query produces`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L118))

When nothing qualifies the handler returns an empty list. ([validated by `returns an empty list when no tasks are ready`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L139))

Each ready task renders as one `- **{spec_task_id}** ({id}): {description}`
bullet under a `## Ready tasks` heading. ([validated by `lore_ready_tasks renders one bullet per ready task`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L363))

An empty ready set renders the "No ready tasks" message rather than an empty
list. ([validated by `lore_ready_tasks reports an empty ready set`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L384))

An unconfigured API yields the not-configured message rather than a PostgreSQL
message. ([validated by `every proxied pipeline tool reports a missing API configuration`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L440))

## Out of Scope

- Claiming a returned task — see [`lore_claim_task`](../claim-task/spec.md).
- Marking tasks done / unblocking — see [`lore_complete_task`](../complete-task/spec.md).
- The dependency-satisfaction SQL's exact `merged`-state semantics beyond the row set it returns.
