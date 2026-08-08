# Feature Specification: GET /api/analytics

| Field      | Value                                                             |
|------------|-------------------------------------------------------------------|
| Feature    | Org-wide pipeline analytics HTTP route                            |
| Status     | In Progress                                                       |
| Created    | 2026-08-08                                                        |
| Owner      | Platform Engineering                                              |
| Route      | `GET /api/analytics`                                              |
| Auth scope | `read`                                                            |
| Module     | `lore-api/src/api/routes/analytics/analytics.ts` (`analyticsRoute`) |

GET /api/analytics returns the org-wide pipeline pulse for one time window — LLM call and token totals, task throughput with success and failure counts, and a per-task-type breakdown — in a single read.

## Problem Statement

`lore_get_analytics` ran three aggregate queries through a local pg pool that the
MCP adapter no longer has (ADR-032), so the tool answered "requires PostgreSQL"
on every call. The aggregates belong on the side that holds the database
credentials; this route runs them and the tool renders the result.

## Interface

- **Method + path**: `GET /api/analytics`
- **Auth**: bearer token with `read` scope (`bearerScope("read")`).

### Request — query params

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `period` | enum `today` \| `week` \| `month` \| `all` | no | `month` | Anything else is a 400. `all` applies no time filter. |

### Response

| Status | Body |
|--------|------|
| 200 | `{ period, usage: { llm_calls, input_tokens, output_tokens }, tasks: { total, succeeded, failed }, by_type: [{ task_type, tasks }] }` |
| 400 | unknown `period` |
| 503 | `{ "error": "database unavailable" }` when the pool is null |
| 500 | `{ "error": "<message>" }` on a query failure |

## Behavior

1. Null pool → 503 `{ error: DB_UNAVAILABLE }` before any work.
2. **Window filter** map: `today` → `created_at > current_date`; `week` →
   `created_at > date_trunc('week', current_date)`; `month` →
   `created_at > date_trunc('month', current_date)`; `all` → `TRUE`.
3. **Parallel fan-out** — `Promise.all` of three queries against the same filter:
   1. Usage — `count(*)` plus `COALESCE(SUM(input_tokens), 0)` /
      `COALESCE(SUM(output_tokens), 0)` over `pipeline.llm_calls`.
   2. Tasks — `count(*)` total, `count(*) FILTER (WHERE status IN ('pr-created','merged'))`
      as succeeded, `count(*) FILTER (WHERE status = 'failed')` as failed, over
      `pipeline.tasks`.
   3. By type — `task_type, count(DISTINCT t.id) as tasks` grouped by
      `task_type`, ordered by count descending.
4. Scalar counts go through `parseInt`; `by_type[].tasks` stays a numeric string
   (raw pg bigint) so a large count is never lossily narrowed.
5. Any thrown error → 500 with the message.

## Output

200 with the analytics object, or one of the 400 / 503 / 500 envelopes above.

## Dependencies & side effects

- Read-only: `pipeline.llm_calls`, `pipeline.tasks`. No writes, no fan-out.
- `pipelineAnalytics` ([queries](../../../apps/lore-api/src/features/analytics/analytics-queries.ts#L27)).

## Acceptance Criteria

Usage, task counts, and the per-type breakdown come back for the default month period. ([validated by `returns usage, task counts and the per-type breakdown for the default month period`](apps/lore-api/src/api/routes/analytics/analytics.test.ts#L42))

The requested period selects its own time filter for every query. ([validated by `filters on the requested period`](apps/lore-api/src/api/routes/analytics/analytics.test.ts#L53))

`period=all` applies no time filter. ([validated by `period=all applies no time filter`](apps/lore-api/src/api/routes/analytics/analytics.test.ts#L65))

An unknown period is rejected with 400 rather than silently defaulting. ([validated by `returns 400 for an unknown period`](apps/lore-api/src/api/routes/analytics/analytics.test.ts#L73))

A null pool returns 503 `database unavailable`. ([validated by `returns 503 when the pool is null`](apps/lore-api/src/api/routes/analytics/analytics.test.ts#L79))

The route is registered as `GET /api/analytics`. ([implemented by](../../../apps/lore-api/src/server/build-server.ts#L130), [implemented by](../../../apps/lore-api/src/api/routes/analytics/analytics.ts#L19))

## Out of Scope

- The MCP tool's rendering and failure copy — owned by [`lore_get_analytics`](../../mcp-tools/get-analytics/spec.md).
- Per-agent footprint — owned by [`GET /api/usage`](../usage/spec.md).
- The web UI analytics dashboard (its own queries, its own page).
