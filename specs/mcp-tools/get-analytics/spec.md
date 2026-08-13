# Feature Specification: lore_get_analytics MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_get_analytics MCP Tool         |
| Status  | In Progress                    |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_get_analytics`                |
| Module  | Usage (`usage-tools.ts`)       |
| Scope   | shared                         |

`lore_get_analytics` returns an org-wide pipeline pulse for a chosen time window — task throughput, success and failure counts, token spend, and a per-type breakdown — so a team lead can read the aggregates without opening the web UI.

## Problem Statement

A team lead wants a quick org-wide pulse — task throughput, success rate, token
spend, and a per-type task breakdown — over a chosen window, without opening the
web UI. `lore_get_analytics` returns those aggregates for one of four fixed periods.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/usage-tools.ts#L85)).

- **name**: `lore_get_analytics`
- **description** (verbatim):

```text
Returns org-wide pipeline analytics for a time window: { period, usage: { llm_calls, input_tokens, output_tokens }, tasks: { total, succeeded, failed }, by_type }. Note: by_type[].tasks is a numeric string (raw pg bigint). Instead: for a single agent's own footprint use lore_my_usage — this tool is not per-agent and does not filter by caller.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `period` | enum | no | `"month"` | "today", "week", "month", or "all" (no time filter). |

## Behavior

The aggregate SQL runs in lore-api behind
[`GET /api/analytics`](../../api-routes/analytics/spec.md); the MCP adapter has no
pool of its own (ADR-032). This tool selects the window and renders the answer.

1. `GET /api/analytics?period=<period>` via `proxyGetApi`. The zod default sends
   `month` when the caller omits the period; the four-value enum is enforced on
   both ends.
2. **Success** — pretty-print the response body verbatim:
   `{ period, usage: { llm_calls, input_tokens, output_tokens },
   tasks: { total, succeeded, failed }, by_type }`, where `by_type[].tasks` stays
   a numeric string (raw pg bigint).
3. **Failure** — one message per cause, never a database message:
   - `not_configured` → the `notConfiguredError("fetching analytics")` text.
   - `denied` (401/403) → the `deniedError("lore_get_analytics", …)` text.
   - `unreachable` → `Could not fetch analytics from the Lore API: {detail}`.
4. Any thrown error is caught and returned as
   `"Error fetching analytics: {message}"`.

## Output

A single MCP text content block: the pretty-printed JSON analytics object, one of
the three failure texts, or the `"Error fetching analytics: …"` text. **Never
throws** — every path returns text.

## Dependencies & side effects

- `proxyGetApi` + `notConfiguredError` / `deniedError` (the shared proxy surface).
- No database handle, no SQL, no writes.
- Env: `LORE_API_URL`, `LORE_INGEST_TOKEN`.

## Acceptance Criteria

The API's analytics object is returned to the caller as pretty-printed JSON. ([validated by `returns the API's analytics object as pretty-printed JSON`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L116))

The requested period is passed through to `/api/analytics`. ([validated by `passes the requested period through to /api/analytics`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L131))

An unconfigured API yields the not-configured message rather than a
PostgreSQL message. ([validated by `reports a missing API configuration instead of a PostgreSQL message`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L138))

An unreachable API surfaces the underlying failure detail. ([validated by `surfaces the failure detail when the API is unreachable`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L146))

## Out of Scope

- Per-developer usage — owned by [`my-usage`](../my-usage/spec.md).
- The aggregate SQL itself — owned by [`GET /api/analytics`](../../api-routes/analytics/spec.md).
- Dark-factory baseline counters (`pipeline.dark_factory_baseline`).
- The web UI analytics dashboard.
