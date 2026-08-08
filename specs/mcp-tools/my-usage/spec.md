# Feature Specification: lore_my_usage MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_my_usage MCP Tool              |
| Status  | In Progress                    |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_my_usage`                     |
| Module  | Usage (`usage-tools.ts`)       |
| Scope   | shared                         |

`lore_my_usage` reports the calling agent's own task count and input/output token totals across today, 7-day, and 30-day windows, giving a developer their delegation footprint without an admin dashboard.

## Problem Statement

A developer delegating tasks to Lore agents wants to see their own footprint —
how many tasks they kicked off and how many tokens those tasks burned — over
recent windows, without an admin dashboard. `lore_my_usage` reports the caller's task
count plus input/output token totals broken down by today, 7-day, and 30-day
periods.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/usage-tools.ts#L54)).

- **name**: `lore_my_usage`
- **description** (verbatim):

```text
Reports the calling agent's own task count and input/output token totals across three windows (today, 7_day, 30_day); returns { agent_id, usage: { today, 7_day, 30_day } }. Instead: for org-wide throughput, success rates, and per-type breakdown use lore_get_analytics — this tool is single-agent only and does not report success rates or per-type counts.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `agent_id` | string | no | — | Agent identifier (email or UUID). Auto-detected from caller when omitted. Pass only to inspect a different agent. |

## Behavior

The tool holds no database. The MCP adapter runs without a pg pool at all
(ADR-032), so the windowed SQL lives in lore-api behind
[`GET /api/usage`](../../api-routes/usage/spec.md) and this tool is a proxy plus
a renderer.

1. Resolve the agent id client-side: `resolveAgentId(agent_id)` (explicit param →
   `LORE_AGENT_ID` → `~/.lore/agent-id` → generated UUID). It is resolved here,
   not server-side, because the identity lives on the caller's machine.
2. `GET /api/usage?agent_id=<resolved>` via `proxyGetApi`, url-encoding the id.
3. **Success** — pretty-print the response body verbatim:
   `JSON.stringify(body, null, 2)`, i.e. `{ agent_id, usage: { today, 7_day, 30_day } }`
   with each period entry `{ tasks, input_tokens, output_tokens }`.
4. **Failure** — one message per cause, never a database message:
   - `not_configured` (no `LORE_API_URL` / `LORE_INGEST_TOKEN`) → the
     `notConfiguredError("reading usage")` text.
   - `denied` (401/403) → the `deniedError("lore_my_usage", …)` text; no cached
     copy is served past an authoritative refusal.
   - `unreachable` → `Could not fetch usage from the Lore API: {detail}`.
5. Any thrown error is caught and returned as `"Error: {message}"`.

## Output

A single MCP text content block: the pretty-printed JSON usage object, one of
the three failure texts, or the `"Error: …"` text. **Never throws**.

## Dependencies & side effects

- `resolveAgentId` (agent id resolution).
- `proxyGetApi` + `notConfiguredError` / `deniedError` (the shared proxy surface).
- No database handle, no SQL, no writes.
- Env: `LORE_API_URL`, `LORE_INGEST_TOKEN`, `LORE_AGENT_ID` (and the
  `~/.lore/agent-id` file).

## Acceptance Criteria

The API's usage object is returned to the caller as pretty-printed JSON. ([validated by `returns the API's usage object as pretty-printed JSON`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L51))

The request goes to `/api/usage` for the resolved agent id. ([validated by `requests /api/usage for the resolved agent id`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L66))

An explicit agent id is url-encoded into the query string. ([validated by `url-encodes an explicit agent id`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L75))

An unconfigured API yields the not-configured message rather than a
PostgreSQL message. ([validated by `reports a missing API configuration instead of a PostgreSQL message`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L82))

A denied token yields the denial message naming the tool. ([validated by `reports a denied token`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L90))

An unreachable API surfaces the underlying failure detail. ([validated by `surfaces the failure detail when the API is unreachable`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L102))

## Out of Scope

- Org-level analytics across all agents — owned by [`get-analytics`](../get-analytics/spec.md).
- The windowed SQL itself — owned by [`GET /api/usage`](../../api-routes/usage/spec.md).
- Cost accounting (the 1.25x write / 0.1x read cache multipliers).
- The web UI usage dashboard.
