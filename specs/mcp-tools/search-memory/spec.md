# Feature Specification: `lore_search_memory` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `lore_search_memory` MCP tool                         |
| Status  | **Draft**                                        |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `lore_search_memory`                                  |
| Module  | memory                                           |
| Scope   | shared                                           |

## Problem Statement

Agents need to find whether a problem was already solved or whether a previous
session left a relevant learning, using natural language rather than exact
keys. The store holds both memories and individually-extracted facts (with
temporal validity), so search must span both, rank by relevance, and return
only currently-valid facts by default while still allowing historical lookups.

## Interface

Registered via `server.tool` ([registration](../../../mcp-server/src/mcp/tools/memory-tools.ts#L162)).

- **name**: `lore_search_memory`
- **description** (verbatim): *"Semantic search across all org memories and
  facts. Returns results ranked by similarity. Facts include temporal validity
  — only currently valid facts are returned by default."*

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `query` | string | yes | — | Natural language search query. |
| `agent_id` | string | no | — | Scope to an agent. Omit for cross-agent search. |
| `pool` | string | no | — | Search within a named shared pool. |
| `limit` | number | no | `10` | Max fused results. |
| `include_invalidated` | boolean | no | `false` | Include facts superseded by newer facts (historical queries). |
| `graph_augment` | boolean | no | `false` | Enrich results with 1-hop graph neighbors of detected entities. |

## Behavior

1. **DB path** — if `isMemoryDbAvailable()`: call `searchMemories(getPool(),
   query, agent_id, pool, limit, include_invalidated, graph_augment)`
   ([handler](../../../mcp-server/src/features/memory/memory-search.ts#L4), re-export of
   `@re-cinq/lore-shared/project/knowledge/memory-search`). The engine:
   1. Resolve `agent` (or null) and, when `pool` given, resolve its `pool_id`
      via `SELECT id FROM memory.shared_pools WHERE name = $1`. **Missing pool →
      audit + return `[]`** (short-circuit).
   2. `embedding = await getQueryEmbedding(query)` (Vertex; null → keyword-only).
   3. When embedding present, run in parallel `vectorSearchMemories` +
      `vectorSearchFacts` (each `ROW_NUMBER() OVER (ORDER BY embedding <=>
      $vec) … LIMIT 20`).
   4. Always run `keywordSearchMemories` + `keywordSearchFacts` (ILIKE `%query%`,
      `ROW_NUMBER() … ORDER BY created_at DESC LIMIT 20`).
   5. Both fact searches gate validity with `($invalidated::boolean OR f.valid_to
      IS NULL)` — so only currently-valid facts unless `include_invalidated`.
      Memory searches gate `is_deleted = FALSE` + non-expired.
   6. `rrfMerge([vectorMemories, vectorFacts, keywordMemories, keywordFacts])`
      — Reciprocal Rank Fusion; each list is contiguous rank order so index
      rank == row rank. Carries `confidence` onto fused rows.
   7. `diversify(merged, limit)` — caps per `agent_id::source` (max 3 each),
      then slices to `limit`.
   8. **Graph augment** (when `graph_augment` and results non-empty):
      `refreshEntityCache` (5-min TTL of `memory.entities` names) →
      `detectEntities` (≥3 chars, max 5) → `graphAugment` (1-hop over
      `memory.edges`, max 10), scored just below the weakest direct hit, then
      sliced back to `limit`.
   9. Fire-and-forget `strengthenRetrievals` (bumps `retrieval_count`,
      `last_retrieved_at`, `half_life_days +2` cap 365; revives `stale`→`observed`).
   10. `auditLog(pool, agent, query, count, latencyMs)` → `memory.audit_log`
       with `operation = 'search'`.
   - Tool emits `JSON.stringify(results, null, 2)`.
2. **Proxy path** — DB unavailable: `proxyMemory("search", { query, agent_id:
   agent_id || undefined, pool_name: pool, limit })`. `ok` → `proxied.body`;
   `unreachable` → `unreachableError("lore_search_memory", detail)`. (`pool` maps to
   `pool_name`; `include_invalidated` / `graph_augment` are not forwarded.)
3. **File fallback** — proxy `not_configured`: `searchMemoryFile(query,
   agent_id, limit)`, return `JSON.stringify(…, null, 2)`.
4. Any thrown error → `"Error searching memories: {message}"`.

## Output

A single MCP text content block. Pretty-printed JSON array of
`{ key, value, score, agent_id, source, id?, confidence? }` (source is
`memory` | `fact` | `episode` | `graph`); or `[]`; or the proxied body; or the
`unreachableError` message; or `"Error searching memories: {message}"`.
**Never throws.**

## Dependencies & side effects

- `isMemoryDbAvailable()`, `getPool()`.
- Engine `searchMemories` ([memory-search.ts](../../../mcp-server/src/features/memory/memory-search.ts#L4)); ranking core `rrfMerge` / `diversify` in `@re-cinq/lore-shared`.
- `proxyMemory` / `unreachableError` ([deps.ts](../../../mcp-server/src/mcp/tools/deps.ts#L98)); `searchMemoryFile` (offline).
- Tables: `memory.memories`, `memory.facts`, `memory.shared_pools`, `memory.entities`, `memory.edges` (reads); `memory.facts` / `memory.memories` (retrieval-strengthening updates); `memory.audit_log` (insert, `operation='search'`).
- Env: `LORE_DB_HOST`, `LORE_API_URL` + `LORE_INGEST_TOKEN`.

## Acceptance Criteria

1. A `pool` argument is resolved to a pool id by name before any search runs. ([validated by `resolves the pool by name before searching`](../../../mcp-server/src/features/memory/memory-search.test.ts#L31))
2. When the named pool does not exist, search short-circuits to an empty
   result. ([validated by `returns empty when the named pool does not exist`](../../../mcp-server/src/features/memory/memory-search.test.ts#L23))
3. RRF rank fusion carries each candidate's confidence onto the fused result. ([validated by `carries confidence from the candidate onto the fused result`](../../../shared/src/memory-ranking.test.ts#L6))
4. Diversification slices the total output to the requested limit across all
   sources. ([validated by `slices the total output to limit across all sources`](../../../shared/src/memory-ranking.test.ts#L66))

## Out of Scope

- Vector embedding generation (owned by the embedding service).
- Retrieval strengthening side-effects (`retrieval_count` / `half_life_days`).
- File-backed fallback search (`searchMemoryFile`).
- GKE-side `/api/memory` route handling.
