# Feature Specification: lore_get_analytics MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_get_analytics MCP Tool         |
| Status  | **Draft**                      |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_get_analytics`                |
| Module  | Usage (`usage-tools.ts`)       |
| Scope   | shared                         |

## Problem Statement

A team lead wants a quick org-wide pulse — task throughput, success rate, token
spend, and a per-type task breakdown — over a chosen window, without opening the
web UI. `lore_get_analytics` returns those aggregates for one of four fixed periods.

## Interface

Registered via `server.tool` ([registration](../../../apps/mcp-server/src/mcp/tools/usage-tools.ts#L53)).

- **name**: `lore_get_analytics`
- **description** (verbatim):

```text
Returns org-wide pipeline analytics for a time window: { period, usage: { llm_calls, input_tokens, output_tokens }, tasks: { total, succeeded, failed }, by_type } (DB-only). Note: by_type[].tasks is a numeric string (raw pg bigint). Instead: for a single agent's own footprint use lore_my_usage — this tool is not per-agent and does not filter by caller.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `period` | enum | no | `"month"` | "today", "week", "month", or "all" (no time filter). |

## Behavior

1. Acquire the pool via `getPool()`. **Availability gate** — if
   `process.env.LORE_DB_HOST` is unset, return the literal text
   `"Analytics requires PostgreSQL (LORE_DB_HOST not set)."` (Note: the gate keys
   on the env var, not on a null pool.)
2. **Period filter** map:
   - `today` → `created_at > current_date`
   - `week` → `created_at > date_trunc('week', current_date)`
   - `month` → `created_at > date_trunc('month', current_date)`
   - `all` → `TRUE`
3. **Parallel fan-out** — `Promise.all` of three queries:
   1. Usage — `SELECT count(*) as calls, COALESCE(SUM(input_tokens),0) as
      input_tokens, COALESCE(SUM(output_tokens),0) as output_tokens FROM
      pipeline.llm_calls WHERE {filter}`.
   2. Tasks — `SELECT count(*) as total, count(*) FILTER (WHERE status IN
      ('pr-created','merged')) as succeeded, count(*) FILTER (WHERE status =
      'failed') as failed FROM pipeline.tasks WHERE {filter}`.
   3. By type — `SELECT t.task_type, count(DISTINCT t.id) as tasks FROM
      pipeline.tasks t WHERE t.{filter} GROUP BY t.task_type ORDER BY tasks DESC`. ([validated by `usage-tools.test.ts:194`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L194))
4. **Success envelope** — assemble
   `{ period, usage: { llm_calls, input_tokens, output_tokens },
   tasks: { total, succeeded, failed }, by_type: rows }` (the scalar counts go
   through `parseInt`; `by_type` rows pass through unchanged) and return
   `JSON.stringify(analytics, null, 2)`.
5. Any thrown error is caught and returned as
   `"Error fetching analytics: {message}"`.

## Output

A single MCP text content block. One of, in priority order: the
PostgreSQL-required text, the pretty-printed JSON analytics object, or the
`"Error fetching analytics: …"` text. **Never throws** — every path returns text.

## Dependencies & side effects

- `getPool()` (pg pool — read but the gate is the `LORE_DB_HOST` env var, so a
  null pool with the env set surfaces as a caught `Error fetching analytics:`).
- Three read-only aggregate `SELECT`s over `pipeline.llm_calls` and
  `pipeline.tasks`, run in parallel via `Promise.all`. No writes.
- Env: `LORE_DB_HOST` (presence gate only).

## Acceptance Criteria

Usage, task, and by_type aggregates are returned as a JSON analytics object for
the month period. ([validated by `returns usage, task, and by_type analytics as JSON for the month period`](../../../apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L114))

The `today` period selects the `created_at > current_date` filter. ([validated by `selects the today filter when period is today`](../../../apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L143))

An unset `LORE_DB_HOST` yields the PostgreSQL-required message. ([validated by `returns a PostgreSQL-required message when LORE_DB_HOST is unset`](../../../apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L161))

A thrown query error is caught and returned as an `Error fetching analytics:`
text block. ([validated by `returns an analytics Error message when a query throws`](../../../apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L170))

## Out of Scope

- Per-developer usage — owned by [`my-usage`](../my-usage/spec.md).
- Dark-factory baseline counters (`pipeline.dark_factory_baseline`).
- The web UI analytics dashboard.
