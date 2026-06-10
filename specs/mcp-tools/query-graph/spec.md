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

## Interface

Registered via `server.tool` ([registration](../../../mcp-server/src/mcp/tools/memory-tools.ts#L264)). The handler body is wrapped in
`trackLatency('query_graph', …)` (records latency into `memory.audit_log` +
OTEL span).

- **name**: `query_graph`
- **description** (verbatim): *"Query the live knowledge graph for entities and
  their relationships. Returns entities connected by typed edges (uses, owns,
  depends-on, etc.) with temporal validity."*

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `entity` | string | no | — | Entity name to query (e.g. `auth-service`). Omit to browse recent edges. |
| `relation_type` | string | no | — | Filter by relation: `uses`, `owns`, `depends-on`, `replaced-by`, `part-of`, `implements`. |
| `repo` | string | no | — | Scope to a specific repo. |
| `include_invalidated` | boolean | no | `false` | Include invalidated (historical) edges. |

## Behavior

1. **DB gate** — if **not** `isMemoryDbAvailable()`: return literal
   `"Knowledge graph requires PostgreSQL (LORE_DB_HOST not set)."` (no proxy
   path — this tool is DB-only).
2. Call `queryLiveGraph(getPool(), entity, relation_type, repo,
   include_invalidated)` ([handler](../../../mcp-server/src/features/memory/graph.ts#L165), re-export of `@re-cinq/lore-shared`):
   - `validFilter = include_invalidated ? "" : "AND e.valid_to IS NULL"`.
   - **`entity` given** → UNION ALL of an **outgoing** leg (`LOWER(s.name) =
     LOWER($1)`) and an **incoming** leg (`LOWER(t.name) = LOWER($1)`), each
     joining `memory.edges e` to `memory.entities` s/t; both gated by
     `validFilter`, optional `relation_type` (`$2`), and repo
     (`s.repo = $3 OR s.repo IS NULL`). `ORDER BY valid_from DESC LIMIT 50`.
   - **`entity` omitted** → browse outgoing edges `WHERE 1=1 {validFilter}`
     with the same relation/repo filters, `ORDER BY e.created_at DESC LIMIT 50`.
3. **Empty guard**: `results.length === 0` → if `entity` given,
   `No relationships found for "{entity}".`; else `Knowledge graph is empty.
   Write episodes or memories to populate it.`
4. Otherwise return `JSON.stringify(results, null, 2)`.
5. Any thrown error → `"Error querying graph: {message}"`.

**Graph population** is owned by `write_episode` →
`extractAndUpdateGraph` ([graph.ts](../../../mcp-server/src/features/memory/graph.ts#L119)): entities are upserted
(`ON CONFLICT (name, entity_type, COALESCE(repo,''))`); an edge with the same
source+relation but a different target sets the prior edge's `valid_to`; an
exact already-valid edge is skipped.

## Output

A single MCP text content block. One of: pretty-printed JSON array of
`{ entity, entity_type, relation, related_entity, related_type, direction
("outgoing"|"incoming"), valid_from }`; `No relationships found for "{entity}".`;
`Knowledge graph is empty…`; the PostgreSQL-required text; or
`"Error querying graph: {message}"`. **Never throws.**

## Dependencies & side effects

- `isMemoryDbAvailable()`, `getPool()`, `trackLatency('query_graph', …)`.
- Query handler `queryLiveGraph` ([graph.ts](../../../mcp-server/src/features/memory/graph.ts#L165)); population via `extractAndUpdateGraph` ([graph.ts](../../../mcp-server/src/features/memory/graph.ts#L119)).
- Tables: `memory.entities` + `memory.edges` (read); `memory.audit_log` (latency insert via `trackLatency`).
- Env: `LORE_DB_HOST`.

## Acceptance Criteria

1. Entities and typed edges parse from the extractor's JSON output. ([validated by `parses entities and edges from JSON`](../../../mcp-server/src/features/memory/graph.test.ts#L42))
2. Entity names are normalized to lowercase so a query matches regardless of
   source casing. ([validated by `normalizes names to lowercase`](../../../mcp-server/src/features/memory/graph.test.ts#L63))
3. A new edge with the same source+relation but a different target invalidates
   the prior edge. ([validated by `invalidates contradictory edges (same source+relation, different target)`](../../../mcp-server/src/features/memory/graph.test.ts#L118))
4. An already-present exact edge is not re-inserted. ([validated by `skips insert when exact edge already exists`](../../../mcp-server/src/features/memory/graph.test.ts#L168))
5. The live read query itself (`queryLiveGraph` SQL + the tool's empty/DB-gate
   framing) has no unit seam. *(untested: requires live
   `memory.entities`/`memory.edges` rows; the population + parse paths are
   covered above.)*

## Out of Scope

- The legacy file-based static graph (`graphSearchHandler` / `graphrag/*.json`).
- LLM entity extraction prompt accuracy.
- Graph augmentation in `search_memory` (covered there).
