# Feature Specification: `lore_agent_stats` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `lore_agent_stats` MCP tool                           |
| Status  | Draft                                            |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `lore_agent_stats`                                    |
| Module  | memory                                           |
| Scope   | shared                                           |

## Problem Statement

There is no single call that tells an operator how much an agent has learned
and how active it is — memory count, fact counts (active vs invalidated),
search activity, shared pools, and recent episodes. Without it, diagnosing a
quiet or runaway agent means hand-writing SQL across several `memory.*` tables.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/memory-tools.ts#L291)).

- **name**: `lore_agent_stats`
- **description** (verbatim):

```text
Returns an agent's combined health and learning statistics as JSON (memory_count, total_facts, active_facts, invalidated_facts, total_searches, recent_episodes, etc.). Use to gauge how much an agent has learned and how active it is. (DB-only — does not proxy.) Instead: lore_my_usage for per-developer LLM token spend.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `agent_id` | string | no | — | Agent to inspect. Omit for the ambient agent. |

## Behavior

1. **DB gate** — if **not** `isMemoryDbAvailable()`: return literal
   `"Agent stats requires PostgreSQL (LORE_DB_HOST not set)."` (DB-only — no
   proxy/file path).
2. `agent = resolveAgentId(agent_id)`; `dbPoolRef = getPool()`.
3. Run three queries via `Promise.all`:
   - `agentHealth(agent_id)` ([handler](../../../apps/mcp-server/src/features/memory/memory.ts#L304)) → `{ agent_id, memory_count,
     last_active, snapshot_count }` from `memory.memories` (active) +
     `memory.snapshots`.
   - `agentStats(agent_id)` ([handler](../../../apps/mcp-server/src/features/memory/memory.ts#L315)) → `{ agent_id, total_memories,
     total_facts, active_facts, invalidated_facts, total_searches,
     shared_pools_created }`. `active`/`invalidated` split on `f.valid_to IS
     NULL`; `total_searches` counts `memory.audit_log` rows with
     `operation = 'search'`; `shared_pools_created` counts distinct
     `memory.shared_pools.created_by = agent`.
   - **Recent-episodes** query (inline): `SELECT e.id, e.source, e.ref,
     e.created_at, LEFT(e.content, 200) as content_preview, (SELECT count(*)
     FROM memory.facts f WHERE f.episode_id = e.id) as fact_count FROM
     memory.episodes e WHERE e.agent_id = $1 ORDER BY e.created_at DESC LIMIT 5`.
     Wrapped in `.catch(() => ({ rows: [] }))` so a failure degrades to empty.
4. Separately count total episodes: `SELECT count(*) … WHERE agent_id = $1`
   (wrapped in try/catch → 0 on failure).
5. Merge into `{ ...health, ...stats, recent_episodes: { total_count,
   latest: rows } }`. Note: both `health` and `stats` carry `agent_id`; the
   latter wins in the spread.
6. Return `JSON.stringify(result, null, 2)`.
7. Any thrown error → `"Error fetching agent stats: {message}"`.

## Output

A single MCP text content block. Either the pretty-printed merged stats object
(`agent_id`, `memory_count`, `last_active`, `snapshot_count`, `total_memories`,
`total_facts`, `active_facts`, `invalidated_facts`, `total_searches`,
`shared_pools_created`, `recent_episodes: { total_count, latest:
[{id, source, ref, created_at, content_preview, fact_count}] }`), the
PostgreSQL-required text, or `"Error fetching agent stats: {message}"`.
**Never throws.**

## Dependencies & side effects

- `isMemoryDbAvailable()`, `getPool()`, `resolveAgentId()`.
- Handlers `agentHealth` ([memory.ts](../../../apps/mcp-server/src/features/memory/memory.ts#L304)) + `agentStats` ([memory.ts](../../../apps/mcp-server/src/features/memory/memory.ts#L315)).
- Tables (read-only): `memory.memories`, `memory.facts`, `memory.snapshots`, `memory.audit_log`, `memory.shared_pools`, `memory.episodes`.
- Env: `LORE_DB_HOST`.
- No writes (read-only aggregation).

## Acceptance Criteria

1. Stats returns fact/memory/search counters keyed to the resolved agent. ([validated by `memory.test.ts:305`](libs/server-core/src/features/memory/memory.test.ts#L305))

2. Health returns memory and snapshot counts keyed to the resolved agent. ([validated by `memory.test.ts:281`](libs/server-core/src/features/memory/memory.test.ts#L281))

3. The recent-episodes preview query and the merge/DB-gate framing have no unit
   seam. *(untested: composed inline in the tool handler; requires live
   `memory.episodes` rows — the health + stats aggregators are covered above.)*

## Out of Scope

- The recent-episodes preview query (composed inline in the tool handler).
- Cross-agent / org-wide aggregation.
- `lore_my_usage` token accounting (separate tool).
