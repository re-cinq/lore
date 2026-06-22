# Feature Specification: lore_list_task_group MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_list_task_group MCP Tool       |
| Status  | **Draft**                      |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_list_task_group`              |
| Module  | pipeline (`pipeline-tools.ts`) |
| Scope   | shared                         |

## Problem Statement

Multi-repo features are coordinated as a task group (shared `task_group_id`). To
know whether the whole feature is done, the caller needs every task in the group
with its per-task status and a completed/total rollup, without running cross-row
SQL by hand.

## Interface

Registered via `server.tool` ([registration + handler](../../../apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L202)).

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

1. **Pool gate** — `getPool()` (from `ToolDeps`); if null, return
   `"Task groups require PostgreSQL (LORE_DB_HOST not set)."` (no stdio proxy).
2. **Inline SELECT** ([query body](../../../apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L214)):
   ```sql
   SELECT id, description, task_type, status, target_repo, pr_url, created_at
   FROM pipeline.tasks WHERE task_group_id = $1 ORDER BY created_at
   ```
   with `[group_id]`.
3. **Empty-group guard** — if `rows.length === 0`, return `"No tasks found for group {group_id}"`.
4. **Rollup** — `completed = rows.filter(t => ['merged','completed'].includes(t.status)).length`;
   `summary = "Group {group_id}: {completed}/{rows.length} completed"`.
5. Return `"{summary}\n\n{JSON.stringify(rows, null, 2)}"`.
6. Any thrown error is caught and returned as `"Error: {message}"`.

## Output

A single MCP text content block — one of: the missing-pool message, the
`"No tasks found for group {id}"` message, the `summary` line followed by the
pretty-printed rows array, or `"Error: {message}"`. **Never throws.**

## Dependencies & side effects

- `getPool()` from `ToolDeps`. Read-only (single SELECT).
- DB table: `pipeline.tasks` (filtered by `task_group_id`).
- Env: `LORE_DB_HOST` (drives whether the pool is non-null) — no proxy path.

## Acceptance Criteria

A group with tasks returns every row ordered by creation time.
*(untested: the group SELECT is inline in the handler closure and not exported as a pure function — testable only against a live Postgres.)*

The completed/total rollup counts only `merged`/`completed` tasks.
*(untested: the rollup count is inline in the handler closure and not exported.)*

A group id with no tasks returns a `No tasks found` message rather than an empty rollup.
*(untested: the empty-group branch is inline in the handler closure and not exported.)*

## Out of Scope

- Creating a group (`group_id` on `lore_create_pipeline_task`).
- Cross-group / global listing (covered by `lore_list_pipeline_tasks`).
