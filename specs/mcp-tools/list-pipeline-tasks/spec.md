# Feature Specification: lore_list_pipeline_tasks MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_list_pipeline_tasks MCP Tool   |
| Status  | In Progress                    |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_list_pipeline_tasks`          |
| Module  | pipeline (`pipeline-tools.ts`) |
| Scope   | shared                         |

`lore_list_pipeline_tasks` returns a newest-first roster of pipeline tasks with a total count, optionally filtered to a single status, without writing SQL or knowing the storage backend.

## Problem Statement

Operators need a quick roster of recent pipeline tasks — optionally narrowed to
a single status (pending, running, failed, …) — newest first, with a total
count, without writing SQL or knowing the storage backend. An invalid status
must fail loudly rather than silently returning everything.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/pipeline-tools-listing.ts#L14)).

- **name**: `lore_list_pipeline_tasks`
- **description** (verbatim):

```text
Lists pipeline tasks newest-first as JSON, optionally filtered by status. General browse view across all tasks and statuses. Instead: lore_list_pending_tasks for unclaimed work to grab locally; lore_ready_tasks for dependency-ready spec-tasks in one repo; lore_list_task_group for one feature's group; lore_list_local_tasks for tasks running on your machine.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `status` | string | no | — | Filter by status: `pending` \| `queued` \| `running` \| `pr-created` \| `review` \| `merged` \| `failed` \| `cancelled`. Omit for all. |
| `limit` | number | no | `20` | Max rows to return. |

## Behavior

1. **Transport branch on `process.env.LORE_DB_HOST`:**
   - **stdio mode (no `LORE_DB_HOST`)** — read `LORE_API_URL` + `LORE_INGEST_TOKEN`;
     if either missing return `"Pipeline requires LORE_API_URL + LORE_INGEST_TOKEN for remote access."`
     Build `URLSearchParams` (`status` if set, `limit=min(limit,100)`),
     `GET {LORE_API_URL}/api/tasks?{params}` with bearer token; on non-2xx
     return `"Remote error: {statusText}"`; on success return the pretty-printed body.
   - **DB mode (`LORE_DB_HOST` set)** — validate `status` against
     `["pending","queued","running","pr-created","review","merged","failed","cancelled"]`;
     an invalid value returns `"invalid status: {status}. Valid values: {list}"`.
     Then call `listTasks(status, min(limit, 100))`
     ([handler wrapper](../../../libs/server-core/src/features/pipeline/pipeline.ts#L45)).
2. **Shared CRUD** ([`listTasks`](../../../libs/shared/src/pipeline-tasks.ts#L117)) — `SELECT id,
   description, task_type, status, target_repo, agent_id, pr_url, created_by,
   created_at, updated_at FROM pipeline.tasks [WHERE status = $1] ORDER BY
   created_at DESC LIMIT $N`, plus `SELECT count(*)::int AS total FROM
   pipeline.tasks [WHERE status = $1]`. Returns `{tasks, total}`.
3. Return `JSON.stringify(result, null, 2)`.
4. Any thrown error is caught and returned as `"Error: {message}"`.

## Output

A single MCP text content block — one of: the missing-config message, the
remote-error message, the `"invalid status: …"` message, the pretty-printed
`{tasks, total}` JSON, or `"Error: {message}"`. **Never throws.**

## Dependencies & side effects

- `listTasks` wrapper → shared `listTasks`. Read-only (two SELECTs).
- DB table: `pipeline.tasks` (summary columns + count).
- Env: `LORE_DB_HOST` (transport switch), `LORE_API_URL`, `LORE_INGEST_TOKEN` (proxy path).
- GET `/api/tasks` on the GKE server (stdio path).

## Acceptance Criteria

With no filter, all tasks are returned alongside a total count.
([validated by `pipeline-crud.test.ts:40`](apps/mcp-server/src/features/pipeline/pipeline-crud.test.ts#L40))

With a status filter, only matching rows and their total are returned.
([validated by `pipeline-crud.test.ts:52`](apps/mcp-server/src/features/pipeline/pipeline-crud.test.ts#L52))

An invalid status string is rejected with the list of valid values.
*(untested: the status allowlist check is inline in the handler closure and not separately exported.)*

The `/api/tasks` HTTP route (the stdio-proxy target) lists tasks with paging: it passes a `status` filter and `limit` through to `listTasks`, caps `limit` at 100, defaults to `limit 20` / `offset 0` and echoes them, passes `offset` through with `total`/`limit`/`offset` metadata, rejects a negative offset or a malformed `status` with 400, and returns 500 when `listTasks` throws. ([validated by GET /api/tasks lists with status and limit](apps/lore-api/src/api/routes/tasks/list-tasks.test.ts#L32), [`list-tasks.test.ts:41`](apps/lore-api/src/api/routes/tasks/list-tasks.test.ts#L41), [`list-tasks.test.ts:47`](apps/lore-api/src/api/routes/tasks/list-tasks.test.ts#L47), [`list-tasks.test.ts:55`](apps/lore-api/src/api/routes/tasks/list-tasks.test.ts#L55), [`list-tasks.test.ts:71`](apps/lore-api/src/api/routes/tasks/list-tasks.test.ts#L71), [`list-tasks.test.ts:84`](apps/lore-api/src/api/routes/tasks/list-tasks.test.ts#L84), [`list-tasks.test.ts:77`](apps/lore-api/src/api/routes/tasks/list-tasks.test.ts#L77))

## Out of Scope

- Single-task detail + timeline (covered by `lore_get_pipeline_status`).
- Group-scoped listing (covered by `lore_list_task_group`).
- Pending-only local-claim view (covered by `lore_list_pending_tasks`).
