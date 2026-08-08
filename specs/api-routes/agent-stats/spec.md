# Feature Specification: GET /api/agent-stats

| Field      | Value                                                               |
|------------|---------------------------------------------------------------------|
| Feature    | Agent health + learning statistics HTTP route                       |
| Status     | In Progress                                                         |
| Created    | 2026-08-08                                                          |
| Owner      | Platform Engineering                                                |
| Route      | `GET /api/agent-stats`                                              |
| Auth scope | `read`                                                              |
| Module     | `lore-api/src/api/routes/analytics/agent-stats.ts` (`agentStatsRoute`) |

GET /api/agent-stats merges one agent's memory health, learning counters, and recent-episode preview into a single object, so an operator can tell a quiet agent from a runaway one without hand-writing SQL across the `memory.*` tables.

## Problem Statement

`lore_agent_stats` read `memory.memories`, `memory.facts`, `memory.snapshots`,
`memory.audit_log`, `memory.shared_pools`, and `memory.episodes` through a local
pool that the MCP adapter no longer has (ADR-032). The tool was permanently
answering "requires PostgreSQL". The aggregation moves here, next to the
credentials, and the tool proxies.

## Interface

- **Method + path**: `GET /api/agent-stats`
- **Auth**: bearer token with `read` scope (`bearerScope("read")`).

### Request — query params

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `agent_id` | string (1–200 chars) | yes | — | Required for the same reason as `/api/usage`: the identity is the caller's, so resolving it server-side would report the pod's. |

### Response

| Status | Body |
|--------|------|
| 200 | `{ agent_id, memory_count, last_active, snapshot_count, total_memories, total_facts, active_facts, invalidated_facts, total_searches, shared_pools_created, recent_episodes: { total_count, latest[] } }` |
| 400 | missing `agent_id` |
| 503 | `{ "error": "database unavailable" }` when the request pool is null **or** the memory pool is unset |
| 500 | `{ "error": "<message>" }` on a query failure |

## Behavior

1. Null request pool **or** `!isMemoryDbAvailable()` → 503
   `{ error: DB_UNAVAILABLE }`.
2. `agentStatsBundle(pool, agent_id)` fans out three reads via `Promise.all`:
   - `agentHealth(agent_id)` ([handler](../../../libs/server-core/src/features/memory/memory.ts#L408)) → memory count, last active, snapshot count.
   - `agentStats(agent_id)` ([handler](../../../libs/server-core/src/features/memory/memory.ts#L423)) → total/active/invalidated facts, total searches, shared pools created.
   - A recent-episodes preview: the five newest `memory.episodes` rows for the
     agent with a 200-char content preview and a per-episode fact count.
3. The episode reads are best-effort — the preview falls back to `[]` and the
   total count to `0` — because an agent with no episode history is still worth
   reporting on.
4. The three results merge into one object; both health and stats carry
   `agent_id`, and the later spread wins.

## Output

200 with the merged object, or one of the 400 / 503 / 500 envelopes above.

## Dependencies & side effects

- Read-only: `memory.memories`, `memory.facts`, `memory.snapshots`,
  `memory.audit_log`, `memory.shared_pools`, `memory.episodes`. No writes.
- `agentStatsBundle` ([queries](../../../apps/lore-api/src/features/analytics/agent-stats-queries.ts#L20)).

## Acceptance Criteria

Health, learning counters, and the recent-episode preview merge into one object. ([validated by `merges health, stats and recent episodes into one object`](apps/lore-api/src/api/routes/analytics/agent-stats.test.ts#L48))

Failing episode reads degrade to zero episodes instead of failing the request. ([validated by `reports zero episodes when the episode queries fail`](apps/lore-api/src/api/routes/analytics/agent-stats.test.ts#L65))

An unset memory pool returns 503 `database unavailable`. ([validated by `returns 503 when memory has no database`](apps/lore-api/src/api/routes/analytics/agent-stats.test.ts#L82))

A missing `agent_id` is rejected with 400. ([validated by `returns 400 when agent_id is missing`](apps/lore-api/src/api/routes/analytics/agent-stats.test.ts#L90))

The route is registered as `GET /api/agent-stats`. ([implemented by](../../../apps/lore-api/src/server/build-server.ts#L131), [implemented by](../../../apps/lore-api/src/api/routes/analytics/agent-stats.ts#L17))

## Out of Scope

- The MCP tool's rendering and failure copy — owned by [`lore_agent_stats`](../../mcp-tools/agent-stats/spec.md).
- Cross-agent / org-wide aggregation.
- Token spend — owned by [`GET /api/usage`](../usage/spec.md).
