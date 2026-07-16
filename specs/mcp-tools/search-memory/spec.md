# Feature Specification: `lore_search_memory` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `lore_search_memory` MCP tool                         |
| Status  | In Progress                                      |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `lore_search_memory`                                  |
| Module  | memory                                           |
| Scope   | shared                                           |

`lore_search_memory` runs a semantic search across org-wide memories and extracted facts, returning relevance-ranked matches with confidence annotations so agents can reuse prior learnings by meaning rather than by exact key.

## Problem Statement

Agents need to find whether a problem was already solved or whether a previous
session left a relevant learning, using natural language rather than exact
keys. The store holds both memories and individually-extracted facts (with
temporal validity), so search must span both, rank by relevance, and return
only currently-valid facts by default while still allowing historical lookups.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/memory-tools.ts#L162)).

- **name**: `lore_search_memory`
- **description** (verbatim):

```text
Semantic (vector + keyword) search across org-wide memories and extracted facts; returns a relevance-ranked array of {key, value, score, agent_id, source, id?, confidence?} (source: memory|fact|episode|graph). Use to find past learnings, decisions, corrections, and facts when you do NOT have an exact key. Instead: lore_read_memory for exact-key lookup; lore_list_memories to enumerate keys; lore_search_context for raw repo document passages (conventions, ADRs, .md text); lore_query_graph to traverse entity relationships; lore_assemble_context for the token-budgeted startup bundle (the mandatory first call).
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `query` | string | yes | — | — |
| `agent_id` | string | no | — | Scope to one agent. Omit for org-wide search. |
| `pool` | string | no | — | Restrict to a named shared pool; non-existent pool name returns empty. |
| `limit` | number | no | `10` | — |
| `include_invalidated` | boolean | no | `false` | When true, also return superseded/historical facts. |
| `graph_augment` | boolean | no | `false` | When true, enrich results with 1-hop knowledge-graph neighbors. |

## Behavior

1. **DB path** — if `isMemoryDbAvailable()`: call `searchMemories(getPool(),
   query, agent_id, pool, limit, include_invalidated, graph_augment)`
   ([handler](../../../apps/mcp-server/src/features/memory/memory-search.ts#L4), re-export of
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
      then slices to `limit`. ([validated by `memory-ranking.test.ts:67`](libs/shared/src/memory-ranking.test.ts#L67))
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
- Engine `searchMemories` ([memory-search.ts](../../../apps/mcp-server/src/features/memory/memory-search.ts#L4)); ranking core `rrfMerge` / `diversify` in `@re-cinq/lore-shared`.
- `proxyMemory` / `unreachableError` ([deps.ts](../../../apps/mcp-server/src/mcp/tools/deps.ts#L98)); `searchMemoryFile` (offline).
- Tables: `memory.memories`, `memory.facts`, `memory.shared_pools`, `memory.entities`, `memory.edges` (reads); `memory.facts` / `memory.memories` (retrieval-strengthening updates); `memory.audit_log` (insert, `operation='search'`).
- Env: `LORE_DB_HOST`, `LORE_API_URL` + `LORE_INGEST_TOKEN`.

## Acceptance Criteria

1. A `pool` argument is resolved to a pool id by name before any search runs. ([validated by `memory-search.test.ts:38`](libs/server-core/src/features/memory/memory-search.test.ts#L38))

2. When the named pool does not exist, search short-circuits to an empty
   result. ([validated by `memory-search.test.ts:25`](libs/server-core/src/features/memory/memory-search.test.ts#L25))

3. RRF rank fusion carries each candidate's confidence onto the fused result. ([validated by `memory-ranking.test.ts:11`](libs/shared/src/memory-ranking.test.ts#L11))

4. Diversification slices the total output to the requested limit across all
   sources. ([validated by `memory-ranking.test.ts:86`](libs/shared/src/memory-ranking.test.ts#L86))

5. Cross-repo candidates are ranked by a case-insensitive transfer score that
   starts at 0.5, adds 0.15 per portable keyword and subtracts 0.15 per local
   keyword, clamped to `[0, 1]` — so portable-rich text scores above the 0.5
   passthrough threshold and local/mixed text is filtered out. ([validated by `transfer-score.test.ts:78`](apps/mcp-server/src/features/context/transfer-score.test.ts#L78), [validated by `transfer-score.test.ts:103`](apps/mcp-server/src/features/context/transfer-score.test.ts#L103), [validated by `transfer-score.test.ts:112`](apps/mcp-server/src/features/context/transfer-score.test.ts#L112))

## Out of Scope

- Vector embedding generation (owned by the embedding service).
- Retrieval strengthening side-effects (`retrieval_count` / `half_life_days`).
- File-backed fallback search (`searchMemoryFile`).
- GKE-side `/api/memory` route handling.
