# Feature Specification: lore_list_task_group MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_list_task_group MCP Tool       |
| Status  | In Progress                    |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_list_task_group`              |
| Module  | pipeline (`pipeline-tools.ts`) |
| Scope   | shared                         |

`lore_list_task_group` lists every task sharing one task_group_id with a completed/total rollup, so a caller can gauge a single multi-repo feature's progress at a glance.

## Problem Statement

Multi-repo features are coordinated as a task group (shared `task_group_id`). To
know whether the whole feature is done, the caller needs every task in the group
with its per-task status and a completed/total rollup, without running cross-row
SQL by hand.

## Interface

Registered via `server.tool` ([registration + handler](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L202)).

- **name**: `lore_list_task_group`
- **description** (verbatim):

```text
Lists every task in one task_group_id with a completed/total rollup — the view for a single multi-repo feature's progress. (DB-only) Instead: lore_list_pipeline_tasks for an unscoped newest-first listing of all tasks.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `group_id` | string | yes | — | Task-group UUID (the value passed as `group_id` to `lore_create_pipeline_task`). |

## Behavior

1. `GET /api/task-groups/{group_id}` via `proxyGetApi`, url-encoding the id. The
   SELECT and the rollup run in lore-api
   ([`GET /api/task-groups/{id}`](../../api-routes/task-group/spec.md)); the MCP
   adapter holds no pool (ADR-032).
2. **Empty-group guard** — if the response reports `total === 0`, return
   `"No tasks found for group {group_id}"`.
3. **Render** — `"Group {group_id}: {completed}/{total} completed\n\n{JSON.stringify(tasks, null, 2)}"`.
4. **Failure** — `not_configured` → the not-configured text; `denied` → the
   denial text; `unreachable` → `"Could not fetch the task group from the Lore API: {detail}"`.

## Output

A single MCP text content block — one of: the missing-pool message, the
`"No tasks found for group {id}"` message, the `summary` line followed by the
pretty-printed rows array, or `"Error: {message}"`. **Never throws.**

## Dependencies & side effects

- `proxyGetApi` + `notConfiguredError` / `deniedError`. Read-only.
- Server-side: `pipeline.tasks` filtered by `task_group_id`.
- Env: `LORE_API_URL`, `LORE_INGEST_TOKEN`. No database handle.

## Acceptance Criteria

The rollup line precedes the pretty-printed task array. ([validated by `lore_list_task_group renders the rollup line above the task JSON`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L440))

A group id with no tasks returns a `No tasks found` message rather than an empty rollup. ([validated by `lore_list_task_group reports an empty group`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L458))

An unconfigured API yields the not-configured message rather than a PostgreSQL message. ([validated by `every proxied pipeline tool reports a missing API configuration`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L579))

An unreachable API (fetch throws) reports the subject-scoped "Could not fetch
the task group" message rather than the generic unreachable copy. ([validated
by `lore_list_task_group reports a subject-scoped fetch message when the API
is unreachable`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L410))

## Out of Scope

- Creating a group (`group_id` on `lore_create_pipeline_task`).
- Cross-group / global listing (covered by `lore_list_pipeline_tasks`).
