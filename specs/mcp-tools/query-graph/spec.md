# Feature Specification: `query_graph` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `query_graph` MCP tool                           |
| Status  | **Draft**                                        |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `query_graph`                                    |
| Module  | memory                                           |
| Scope   | shared                                           |

## Problem Statement

Facts and memories answer "what is true" but not "how things connect" — which
service uses which technology, which team owns which service, what replaced
what. Agents need to read the live knowledge graph: query an entity's typed
relationships, filter by relation type or repo, and optionally see historical
(invalidated) edges. The graph must reflect the latest truth, so contradictory
edges must be temporally invalidated as new episodes arrive.

## Solution

`query_graph` reads `memory.entities` + `memory.edges` via `queryLiveGraph`,
returning entities connected by typed edges (`uses`, `owns`, `depends-on`,
`replaced-by`, `part-of`, `implements`) with temporal validity. The graph is
populated by `extractAndUpdateGraph` (driven by `write_episode`): entities are
upserted, and a new edge with the same source+relation but a different target
invalidates the prior edge so a query returns only current truth unless
`include_invalidated` is set.

- Registration: [`memory-tools.ts`](../../../mcp-server/src/mcp/tools/memory-tools.ts#L264) (IMPLEMENTED_BY)
- Query handler: [`graph.ts` `queryLiveGraph`](../../../mcp-server/src/features/memory/graph.ts#L165) (re-export of `@re-cinq/lore-shared`) (IMPLEMENTED_BY)
- Graph population: [`graph.ts` `extractAndUpdateGraph`](../../../mcp-server/src/features/memory/graph.ts#L119) (IMPLEMENTED_BY)

## Acceptance Criteria

1. Entities and typed edges parse from the extractor's JSON output. ([validated by `parses entities and edges from JSON`](../../../mcp-server/src/features/memory/graph.test.ts#L42))
2. Entity names are normalized to lowercase so a query matches regardless of
   source casing. ([validated by `normalizes names to lowercase`](../../../mcp-server/src/features/memory/graph.test.ts#L63))
3. A new edge with the same source+relation but a different target invalidates
   the prior edge. ([validated by `invalidates contradictory edges (same source+relation, different target)`](../../../mcp-server/src/features/memory/graph.test.ts#L118))
4. An already-present exact edge is not re-inserted. ([validated by `skips insert when exact edge already exists`](../../../mcp-server/src/features/memory/graph.test.ts#L168))

## Out of Scope

- The live read query itself (`queryLiveGraph` SQL) (untested: requires live
  `memory.entities`/`memory.edges` rows).
- The legacy file-based static graph (`graphSearchHandler`).
- LLM entity extraction prompt accuracy.
