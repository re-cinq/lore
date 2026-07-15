# Feature Specification: lore_my_usage MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_my_usage MCP Tool              |
| Status  | **Draft**                      |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_my_usage`                     |
| Module  | Usage (`usage-tools.ts`)       |
| Scope   | shared                         |

## Problem Statement

A developer delegating tasks to Lore agents wants to see their own footprint —
how many tasks they kicked off and how many tokens those tasks burned — over
recent windows, without an admin dashboard. `lore_my_usage` reports the caller's task
count plus input/output token totals broken down by today, 7-day, and 30-day
periods.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/usage-tools.ts#L10)).

- **name**: `lore_my_usage`
- **description** (verbatim):

```text
Reports the calling agent's own task count and input/output token totals across three windows (today, 7_day, 30_day); returns { agent_id, usage: { today, 7_day, 30_day } } (DB-only). Instead: for org-wide throughput, success rates, and per-type breakdown use lore_get_analytics — this tool is single-agent only and does not report success rates or per-type counts.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `agent_id` | string | no | — | Agent identifier (email or UUID). Auto-detected from caller when omitted. Pass only to inspect a different agent. |

## Behavior

1. Acquire the pool via `getPool()`. **Availability gate** — if it is null,
   return the literal text
   `"Usage tracking requires PostgreSQL (LORE_DB_HOST not set)."`
2. Resolve the agent id: `agent = resolveAgentId(agent_id)` (explicit param →
   `LORE_AGENT_ID` → `~/.lore/agent-id` → generated UUID).
3. **Per-period fan-out** — for each of three periods, run one query:
   - `today` → filter `t.created_at > current_date`
   - `7_day` → filter `t.created_at > current_date - interval '7 days'`
   - `30_day` → filter `t.created_at > current_date - interval '30 days'`

   Each query is:
   ```sql
   SELECT COUNT(DISTINCT t.id)::int as tasks,
          COALESCE(SUM(lc.input_tokens), 0)::bigint as input_tokens,
          COALESCE(SUM(lc.output_tokens), 0)::bigint as output_tokens
   FROM pipeline.tasks t
   LEFT JOIN pipeline.llm_calls lc ON lc.task_id = t.id
   WHERE (t.created_by = $1 OR t.created_by LIKE $2 OR t.agent_id = $1)
     AND <period filter>
   ```
   with params `[agent, '%' + agent.substring(0, 8) + '%']`. The `$2` LIKE matches
   on the agent id's first 8 chars so short-prefix `created_by` values still
   attribute. Token sums come back as `bigint` strings and are coerced with
   `Number(...)`.
4. **Success envelope** — return
   `JSON.stringify({ agent_id: agent, usage: { today, 7_day, 30_day } }, null, 2)`,
   each period entry `{ tasks, input_tokens, output_tokens }`.
5. Any thrown error is caught and returned as `"Error: {message}"`.

## Output

A single MCP text content block. One of, in priority order: the
PostgreSQL-required text, the pretty-printed JSON usage object, or the
`"Error: …"` text. **Never throws** — every path returns text.

## Dependencies & side effects

- `getPool()` (pg pool; null-checked).
- `resolveAgentId` (from `@re-cinq/lore-shared`).
- Three read-only `SELECT`s over `pipeline.tasks LEFT JOIN pipeline.llm_calls`.
  No writes.
- Env: `LORE_AGENT_ID` (consumed by `resolveAgentId`), `~/.lore/agent-id` file.

## Acceptance Criteria

Per-period task counts and token totals are returned as a JSON usage object keyed
by today / 7_day / 30_day. ([validated by `returns per-period task and token totals as JSON`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L42))

One query is issued per period, parameterized with the resolved agent id and an
8-char LIKE prefix, with the correct interval filters. ([validated by `issues one query per period with the agent id and 8-char LIKE prefix params`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L76))

A null pool yields the PostgreSQL-required message. ([validated by `returns a PostgreSQL-required message when the pool is null`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L96))

A thrown query error is caught and returned as an `Error:` text block. ([validated by `returns an Error message when the query throws`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L105))

## Out of Scope

- Org-level analytics across all agents — owned by [`get-analytics`](../get-analytics/spec.md).
- Cost accounting (the 1.25x write / 0.1x read cache multipliers).
- The web UI usage dashboard.
