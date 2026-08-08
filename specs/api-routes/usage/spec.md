# Feature Specification: GET /api/usage

| Field      | Value                                                     |
|------------|-----------------------------------------------------------|
| Feature    | Per-agent usage HTTP route                                |
| Status     | In Progress                                               |
| Created    | 2026-08-08                                                |
| Owner      | Platform Engineering                                      |
| Route      | `GET /api/usage`                                          |
| Auth scope | `read`                                                    |
| Module     | `lore-api/src/api/routes/analytics/usage.ts` (`usageRoute`) |

GET /api/usage reports one agent's delegation footprint — task count plus input and output token totals across today, 7-day, and 30-day windows — so the `lore_my_usage` MCP tool can answer without a database of its own.

## Problem Statement

`lore_my_usage` used to run its windowed SQL through a local pg pool. Since the
local/remote split (ADR-032) the MCP adapter has no pool at all, so the tool
answered "requires PostgreSQL (LORE_DB_HOST not set)" on every call — dead code,
not a misconfiguration. The query has to run where the credentials are. This
route is that home: three windowed aggregates over `pipeline.tasks` joined to
`pipeline.llm_calls`, keyed to one agent.

## Interface

- **Method + path**: `GET /api/usage`
- **Auth**: bearer token with `read` scope (`bearerScope("read")`). Missing
  bearer → 401; insufficient scope → 403.

### Request — query params

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `agent_id` | string (1–200 chars) | yes | — | Agent identifier (email or UUID). Required, not resolved server-side: the identity lives in the caller's `LORE_AGENT_ID` / `~/.lore/agent-id`, so resolving it here would report the pod's identity. |

### Response

| Status | Body |
|--------|------|
| 200 | `{ agent_id, usage: { today, "7_day", "30_day" } }`, each period `{ tasks, input_tokens, output_tokens }` |
| 400 | zod validation failure (missing/blank `agent_id`) |
| 503 | `{ "error": "database unavailable" }` when the pool is null |
| 500 | `{ "error": "<message>" }` on a query failure |

## Behavior

1. Null pool → 503 `{ error: DB_UNAVAILABLE }` before any work.
2. `agentUsage(pool, agent_id)` runs one query per window, in order — `today`
   (`t.created_at > current_date`), `7_day` (`- interval '7 days'`), `30_day`
   (`- interval '30 days'`) — each:
   ```sql
   SELECT COUNT(DISTINCT t.id)::int as tasks,
          COALESCE(SUM(lc.input_tokens), 0)::bigint as input_tokens,
          COALESCE(SUM(lc.output_tokens), 0)::bigint as output_tokens
   FROM pipeline.tasks t
   LEFT JOIN pipeline.llm_calls lc ON lc.task_id = t.id
   WHERE (t.created_by = $1 OR t.created_by LIKE $2 OR t.agent_id = $1)
     AND <window filter>
   ```
   with params `[agentId, '%' + agentId.slice(0, 8) + '%']`. The `LIKE` matches on
   the first 8 characters so short-prefix `created_by` values still attribute to
   the same developer.
3. Token sums arrive as bigint strings and are coerced with `Number(...)`.
4. Any thrown error → 500 with the message.

## Output

200 `{ agent_id, usage }` with three period entries, or one of the 400 / 503 /
500 envelopes above.

## Dependencies & side effects

- Read-only: `pipeline.tasks`, `pipeline.llm_calls`. No writes, no fan-out.
- `agentUsage` ([queries](../../../apps/lore-api/src/features/analytics/usage-queries.ts#L29)).

## Acceptance Criteria

Per-period task counts and token totals come back as a JSON usage object keyed by today / 7_day / 30_day. ([validated by `returns per-period task and token totals for the agent`](apps/lore-api/src/api/routes/analytics/usage.test.ts#L24))

One query is issued per window, parameterized with the agent id and its 8-char LIKE prefix, with the correct interval filters. ([validated by `queries each period with the agent id and its 8-char LIKE prefix`](apps/lore-api/src/api/routes/analytics/usage.test.ts#L49))

A missing `agent_id` is rejected with 400. ([validated by `returns 400 when agent_id is missing`](apps/lore-api/src/api/routes/analytics/usage.test.ts#L69))

A null pool returns 503 `database unavailable`. ([validated by `returns 503 when the pool is null`](apps/lore-api/src/api/routes/analytics/usage.test.ts#L75))

The route is registered as `GET /api/usage`. ([implemented by](../../../apps/lore-api/src/server/build-server.ts#L129), [implemented by](../../../apps/lore-api/src/api/routes/analytics/usage.ts#L17))

## Out of Scope

- The MCP tool's rendering and failure copy — owned by [`lore_my_usage`](../../mcp-tools/my-usage/spec.md).
- Org-wide aggregates — owned by [`GET /api/analytics`](../analytics/spec.md).
- Cost accounting (the cache-read/write price multipliers).
