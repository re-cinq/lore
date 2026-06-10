# Feature Specification: get_pipeline_status MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | get_pipeline_status MCP Tool   |
| Status  | **Draft**                      |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `get_pipeline_status`          |
| Module  | pipeline (`pipeline-tools.ts`) |
| Scope   | shared                         |

## Problem Statement

After delegating a task, the caller needs to see where it stands — current
status plus the full ordered event timeline (pending → running → pr-created →
…) — by task id alone, without knowing whether the server is local (stdio
proxy) or on GKE (direct DB). A missing id must be reported distinctly from an
error.

## Interface

Registered via `server.tool` ([registration](../../../mcp-server/src/mcp/tools/pipeline-tools.ts#L87)).

- **name**: `get_pipeline_status`
- **description** (verbatim): *"Retrieve the current status of a pipeline task,
  including its full event timeline."*

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `task_id` | string | yes | — | UUID of the pipeline task. |

## Behavior

1. **Transport branch on `process.env.LORE_DB_HOST`:**
   - **stdio mode (no `LORE_DB_HOST`)** — read `LORE_API_URL` + `LORE_INGEST_TOKEN`;
     if either missing return `"Pipeline requires LORE_API_URL + LORE_INGEST_TOKEN for remote access."`
     Otherwise `GET {LORE_API_URL}/api/task/{task_id}` with `Authorization: Bearer {token}`;
     on non-2xx return `"Remote error: {statusText}"`; on success return the
     pretty-printed (`JSON.stringify(…, null, 2)`) response body.
   - **DB mode (`LORE_DB_HOST` set)** — call `getTask(task_id)`
     ([handler wrapper](../../../mcp-server/src/features/pipeline/pipeline.ts#L35)).
2. **Shared CRUD** ([`getTask`](../../../shared/src/pipeline-tasks.ts#L107)) — `SELECT * FROM
   pipeline.tasks WHERE id = $1`; if no row, return `null`; otherwise `SELECT *
   FROM pipeline.task_events WHERE task_id = $1 ORDER BY created_at` and return
   the task row spread with an `events` array.
3. **Not-found guard** — when the wrapper returns `null`, return `"task not found: {task_id}"`.
4. **Success** — return the task object (row + `events`) as `JSON.stringify(task, null, 2)`.
5. Any thrown error is caught and returned as `"Error: {message}"`.

## Output

A single MCP text content block — one of: the missing-config message, the
remote-error message, the `"task not found: {id}"` message, the pretty-printed
task JSON (`{...row, events: [...]}`), or `"Error: {message}"`. **Never throws.**

## Dependencies & side effects

- `getTask` wrapper → shared `getTask`. Read-only.
- DB tables: `pipeline.tasks`, `pipeline.task_events` (ordered by `created_at`).
- Env: `LORE_DB_HOST` (transport switch), `LORE_API_URL`, `LORE_INGEST_TOKEN` (proxy path).
- GET `/api/task/:id` on the GKE server (stdio path).

## Acceptance Criteria

A task id with no matching row resolves to `null` (the handler surfaces this as
`task not found`).
([validated by `returns null when no task row matches the id`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L21))

A matching id returns the task row merged with its ordered `events` array.
([validated by `returns the task with its ordered events when the id matches`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L27))

The stdio-proxy branch and the not-found/error envelope framing are exercised
only against a live API or DB.
*(untested: the transport switch is inline in the handler closure — the proxy branch needs a live API; the shared CRUD is covered above.)*

## Out of Scope

- Live PR / CI state (covered by `get_pr_status`).
- Execution log bytes (covered by `get_task_logs`).
- Cross-task group rollups (covered by `list_task_group`).
