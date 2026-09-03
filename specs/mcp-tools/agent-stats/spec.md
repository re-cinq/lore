# Feature Specification: `lore_agent_stats` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `lore_agent_stats` MCP tool                           |
| Status  | In Progress                                      |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `lore_agent_stats`                                    |
| Module  | memory                                           |
| Scope   | shared                                           |

`lore_agent_stats` returns one agent's combined health and learning metrics — memory count, active vs invalidated fact counts, search activity, shared pools, and recent episodes — as a single JSON block for operators diagnosing a quiet or runaway agent.

## Problem Statement

There is no single call that tells an operator how much an agent has learned
and how active it is — memory count, fact counts (active vs invalidated),
search activity, shared pools, and recent episodes. Without it, diagnosing a
quiet or runaway agent means hand-writing SQL across several `memory.*` tables.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/memory-tools.ts#L557)).

- **name**: `lore_agent_stats`
- **description** (verbatim):

```text
Returns an agent's combined health and learning statistics as JSON (memory_count, total_facts, active_facts, invalidated_facts, total_searches, recent_episodes, etc.). Use to gauge how much an agent has learned and how active it is. Instead: lore_my_usage for per-developer LLM token spend.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `agent_id` | string | no | — | Agent to inspect. Omit for the ambient agent. |

## Behavior

The aggregation runs in lore-api behind
[`GET /api/agent-stats`](../../api-routes/agent-stats/spec.md) — the MCP adapter
holds no pool (ADR-032), so the `memory.*` reads happen where the credentials
are and this tool proxies.

1. Resolve the agent id client-side (`resolveAgentId(agent_id)`): the identity
   lives in the caller's `LORE_AGENT_ID` / `~/.lore/agent-id`, not on the server.
2. `GET /api/agent-stats?agent_id=<resolved>` via `proxyGetApi`.
3. **Success** — pretty-print the merged object verbatim
   (`JSON.stringify(body, null, 2)`).
4. **Failure** — `not_configured` → `notConfiguredError("fetching agent stats")`;
   `denied` → `deniedError("lore_agent_stats", …)`; `unreachable` →
   `Could not fetch agent stats from the Lore API: {detail}`.
5. Any thrown error → `"Error fetching agent stats: {message}"`.

## Output

A single MCP text content block. Either the pretty-printed merged stats object
(`agent_id`, `memory_count`, `last_active`, `snapshot_count`, `total_memories`,
`total_facts`, `active_facts`, `invalidated_facts`, `total_searches`,
`shared_pools_created`, `recent_episodes: { total_count, latest:
[{id, source, ref, created_at, content_preview, fact_count}] }`), one of the
three failure texts, or `"Error fetching agent stats: {message}"`.
**Never throws.**

## Dependencies & side effects

- `resolveAgentId()`, `proxyGetApi`, `notConfiguredError` / `deniedError`.
- No database handle, no SQL, no writes — the tables are read server-side.
- Env: `LORE_API_URL`, `LORE_INGEST_TOKEN`, `LORE_AGENT_ID`.

## Acceptance Criteria

The request goes to `GET /api/agent-stats` for the resolved agent with the
bearer token, and the response is printed as JSON. ([validated by `proxies to GET /api/agent-stats for the resolved agent and prints the JSON`](apps/mcp-server/src/mcp/tools/memory-tools.test.ts#L108))

An unconfigured API yields the not-configured message rather than a
PostgreSQL message. ([validated by `reports a missing API configuration instead of a PostgreSQL message`](apps/mcp-server/src/mcp/tools/memory-tools.test.ts#L125))

Stats returns fact/memory/search counters keyed to the resolved agent. ([validated by `memory.test.ts:307`](libs/server-core/src/features/memory/memory.test.ts#L307))

Health returns memory and snapshot counts keyed to the resolved agent. ([validated by `memory.test.ts:283`](libs/server-core/src/features/memory/memory.test.ts#L283))

## Out of Scope

- The recent-episodes preview query and the merge — owned by [`GET /api/agent-stats`](../../api-routes/agent-stats/spec.md).
- Cross-agent / org-wide aggregation.
- `lore_my_usage` token accounting (separate tool).
