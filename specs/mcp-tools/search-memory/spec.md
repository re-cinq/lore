# Feature Specification: `search_memory` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `search_memory` MCP tool                         |
| Status  | **Draft**                                        |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `search_memory`                                  |
| Module  | memory                                           |
| Scope   | shared                                           |

## Problem Statement

Agents need to find whether a problem was already solved or whether a previous
session left a relevant learning, using natural language rather than exact
keys. The store holds both memories and individually-extracted facts (with
temporal validity), so search must span both, rank by relevance, and return
only currently-valid facts by default while still allowing historical lookups.

## Solution

`search_memory` runs semantic search across `memory.memories` and
`memory.facts`. It combines vector similarity (Vertex embeddings) and keyword
(ILIKE) results via Reciprocal Rank Fusion, then diversifies the top results.
It degrades to keyword-only when embeddings are unavailable. A `pool` argument
scopes to a named shared pool; `include_invalidated` widens to superseded
facts; `graph_augment` enriches with 1-hop graph neighbors. The ranking core
(`rrfMerge` / `diversify`) is single-sourced in `@re-cinq/lore-shared`.

- Registration: [`memory-tools.ts`](../../../mcp-server/src/mcp/tools/memory-tools.ts#L162) (IMPLEMENTED_BY)
- Handler: [`memory-search.ts` `searchMemories`](../../../mcp-server/src/features/memory/memory-search.ts#L4) (re-export of `@re-cinq/lore-shared/project/knowledge/memory-search`) (IMPLEMENTED_BY)

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
