# Feature Specification: lore_get_pipeline_status MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_get_pipeline_status MCP Tool   |
| Status  | In Progress                    |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_get_pipeline_status`          |
| Module  | pipeline (`pipeline-tools.ts`) |
| Scope   | shared                         |

`lore_get_pipeline_status` returns one pipeline task's full record — its current status plus the ordered event timeline — by task id, reporting a missing id distinctly from an error and working whether the server is local or on GKE.

## Problem Statement

After delegating a task, the caller needs to see where it stands — current
status plus the full ordered event timeline (pending → running → pr-created →
…) — by task id alone, without knowing whether the server is local (stdio
proxy) or on GKE (direct DB). A missing id must be reported distinctly from an
error.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L87)).

- **name**: `lore_get_pipeline_status`
- **description** (verbatim):

```text
Returns one pipeline task's full record (status + ordered event timeline) as JSON, by UUID. Instead: lore_list_pipeline_tasks for a multi-task listing; lore_get_pr_status for the live GitHub PR/CI verdict; lore_get_task_logs for the execution transcript; lore_list_task_group for a group rollup.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `task_id` | string | yes | — | UUID of the pipeline task. |

## Behavior

1. **Transport branch on `process.env.LORE_DB_HOST`:**
   - **stdio mode (no `LORE_DB_HOST`)** — read `LORE_API_URL` + `LORE_INGEST_TOKEN`;
     if either missing return the shared `notConfiguredError("getting pipeline status")`.
     Otherwise `GET {LORE_API_URL}/api/task/{task_id}` with `Authorization: Bearer {token}`.
     A thrown `fetch` (network failure) returns `unreachableError`; a `401`/`403`
     returns `deniedError`; any other non-2xx returns `"Remote error: {statusText}"`;
     on success return the pretty-printed (`JSON.stringify(…, null, 2)`) response body.
   - **DB mode (`LORE_DB_HOST` set)** — call `getTask(task_id)`
     ([handler wrapper](../../../libs/server-core/src/features/pipeline/pipeline.ts#L41)).
2. **Shared CRUD** ([`getTask`](../../../libs/shared/src/pipeline-tasks.ts#L107)) — `SELECT * FROM
   pipeline.tasks WHERE id = $1`; if no row, return `null`; otherwise `SELECT *
   FROM pipeline.task_events WHERE task_id = $1 ORDER BY created_at` and return
   the task row spread with an `events` array.
3. **Not-found guard** — when the wrapper returns `null`, return `"task not found: {task_id}"`.
4. **Success** — return the task object (row + `events`) as `JSON.stringify(task, null, 2)`.
5. Any thrown error is caught and returned as `"Error getting pipeline status: {message}"`.

## Output

A single MCP text content block — one of: the not-configured / denied / unreachable
proxy message, the remote-error message, the `"task not found: {id}"` message, the
pretty-printed task JSON (`{...row, events: [...]}`), or
`"Error getting pipeline status: {message}"`. **Never throws.**

## Dependencies & side effects

- `getTask` wrapper → shared `getTask`. Read-only.
- DB tables: `pipeline.tasks`, `pipeline.task_events` (ordered by `created_at`).
- Env: `LORE_DB_HOST` (transport switch), `LORE_API_URL`, `LORE_INGEST_TOKEN` (proxy path).
- GET `/api/task/:id` on the GKE server (stdio path).

## Acceptance Criteria

A task id with no matching row resolves to `null` (the handler surfaces this as
`task not found`).
([validated by `returns null when no task row matches the id`](apps/mcp-server/src/features/pipeline/pipeline-crud.test.ts#L13))

A matching id returns the task row merged with its ordered `events` array.
([validated by `returns the task with its ordered events when the id matches`](apps/mcp-server/src/features/pipeline/pipeline-crud.test.ts#L20))

The stdio-proxy branch selects the not-configured, denied, and unreachable errors
by cause (missing env, 401/403, network failure).
([validated by `returns the not-configured message when the env is unset`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L163), [validated by `returns the denied message on a 401`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L177), [validated by `returns the unreachable message when fetch throws`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L195))

The not-found and success envelope framing on the stdio path are exercised only
against a live API. *(untested: the transport switch is inline in the handler
closure — the success/not-found proxy responses need a live API; the shared CRUD
is covered above.)*

The `/api/task/:id` HTTP route (the stdio-proxy target) returns the task when found, 404 when no row matches, and 500 when the lookup throws. ([validated by GET /api/task/:id returns the task when found](apps/lore-api/src/api/routes/tasks/get-task.test.ts#L32), [`get-task.test.ts:39`](apps/lore-api/src/api/routes/tasks/get-task.test.ts#L39), [`get-task.test.ts:46`](apps/lore-api/src/api/routes/tasks/get-task.test.ts#L46))

## Out of Scope

- Live PR / CI state (covered by `lore_get_pr_status`).
- The execution transcript (covered by `lore_get_task_logs`).
- Cross-task group rollups (covered by `lore_list_task_group`).
