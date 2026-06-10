# Feature Specification: list_pipeline_tasks MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | list_pipeline_tasks MCP Tool   |
| Status  | **Draft**                      |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `list_pipeline_tasks`          |
| Module  | pipeline (`pipeline-tools.ts`) |
| Scope   | shared                         |

## Problem Statement

Operators need a quick roster of recent pipeline tasks — optionally narrowed to
a single status (pending, running, failed, …) — newest first, with a total
count, without writing SQL or knowing the storage backend. An invalid status
must fail loudly rather than silently returning everything.

## Interface

Registered via `server.tool` ([registration](../../../mcp-server/src/mcp/tools/pipeline-tools.ts#L131)).

- **name**: `list_pipeline_tasks`
- **description** (verbatim): *"List pipeline tasks with optional filtering by
  status. Returns tasks ordered by creation time, newest first."*

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `status` | string | no | — | Filter, e.g. `pending` \| `queued` \| `running` \| `pr-created` \| `review` \| `merged` \| `failed` \| `cancelled`. Omit for all. Validated in DB mode. |
| `limit` | number | no | `20` | Clamped to `min(limit, 100)`. |

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
     ([handler wrapper](../../../mcp-server/src/features/pipeline/pipeline.ts#L36)).
2. **Shared CRUD** ([`listTasks`](../../../shared/src/pipeline-tasks.ts#L117)) — `SELECT id,
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
([validated by `returns all rows with a total count when no status filter is given`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L42))

With a status filter, only matching rows and their total are returned.
([validated by `returns the filtered rows and matching total when a status is given`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L53))

An invalid status string is rejected with the list of valid values.
*(untested: the status allowlist check is inline in the handler closure and not separately exported.)*

## Out of Scope

- Single-task detail + timeline (covered by `get_pipeline_status`).
- Group-scoped listing (covered by `list_task_group`).
- Pending-only local-claim view (covered by `list_pending_tasks`).
