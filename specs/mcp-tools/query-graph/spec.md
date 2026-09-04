# Feature Specification: `lore_query_graph` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `lore_query_graph` MCP tool                           |
| Status  | In Progress                                      |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `lore_query_graph`                                    |
| Module  | memory                                           |
| Scope   | shared                                           |

`lore_query_graph` reads the live knowledge graph and returns an entity's typed relationship edges, filtered by relation type or repo, so agents can see structured connections rather than prose.

## Problem Statement

Facts and memories answer "what is true" but not "how things connect" — which
service uses which technology, which team owns which service, what replaced
what. Agents need to read the live knowledge graph: query an entity's typed
relationships, filter by relation type or repo, and optionally see historical
(invalidated) edges. The graph must reflect the latest truth, so contradictory
edges must be temporally invalidated as new episodes arrive.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/memory-tools.ts#L264)). The handler body is wrapped in
`trackLatency('lore_query_graph', …)` (records latency into `memory.audit_log` +
OTEL span).

- **name**: `lore_query_graph`
- **description** (verbatim):

```text
Reads the live knowledge graph and returns typed relationship edges {entity, entity_type, relation, related_entity, related_type, direction, valid_from} for one entity, or recent edges when no entity given. Use when you want structured relationships (uses/owns/depends-on/replaced-by), not prose. Graph is populated asynchronously by lore_write_episode — no writes here. Instead: lore_search_memory for learnings and facts in prose form; lore_search_context for raw document passages; lore_assemble_context for the token-budgeted startup bundle.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `entity` | string | no | — | Entity name (case-insensitive); matched against both edge endpoints. Omit to browse recent edges. |
| `relation_type` | string | no | — | Filter to one relation type, e.g. "uses", "owns", "depends-on", "replaced-by", "part-of", "implements". |
| `repo` | string | no | — | Scope to a specific repo, e.g. "re-cinq/lore". Repo-less edges excluded when set. |
| `include_invalidated` | boolean | no | `false` | When true, also include historically-invalidated edges. |

## Behavior

1. **DB gate → remote proxy** — if **not** `isMemoryDbAvailable()` (local
   stdio mode), proxy the read to the GKE server: `GET /api/graph` with the
   `entity`/`relation_type`/`repo`/`include_invalidated` query params and a
   `Bearer ${LORE_INGEST_TOKEN}` header (via `proxyGetApi`). On success return
   the JSON body; if the API is configured-but-unreachable return the standard
   `unreachableError`; if `LORE_API_URL` is unset return `"Knowledge graph
   requires PostgreSQL (LORE_DB_HOST) or a configured LORE_API_URL."` The server
   side is `handleGraph` (`GET /api/graph`, `read` scope) calling the same
   `queryLiveGraph`.
2. Call `queryLiveGraph(getPool(), entity, relation_type, repo,
   include_invalidated)` ([handler](../../../libs/server-core/src/features/memory/graph.ts#L200), re-export of `@re-cinq/lore-shared`):
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

**Graph population** is owned by `lore_write_episode` →
`extractAndUpdateGraph` ([graph.ts](../../../libs/server-core/src/features/memory/graph.ts#L134)): entities are upserted
(`ON CONFLICT (name, entity_type, COALESCE(repo,''))`); an edge with the same
source+relation but a different target sets the prior edge's `valid_to`; an
exact already-valid edge is skipped. A failed entity upsert is skipped rather
than aborting the batch, and any edge that depended on it (source or target
missing from the upserted set) is skipped in turn; a failed edge upsert is
likewise skipped without blocking the remaining edges. ([validated by `graph-edge.test.ts:116`](libs/server-core/src/features/memory/graph-edge.test.ts#L116), [`graph-edge.test.ts:163`](libs/server-core/src/features/memory/graph-edge.test.ts#L163))

## Output

A single MCP text content block. One of: pretty-printed JSON array of
`{ entity, entity_type, relation, related_entity, related_type, direction
("outgoing"|"incoming"), valid_from }`; `No relationships found for "{entity}".`;
`Knowledge graph is empty…`; the PostgreSQL-required text; or
`"Error querying graph: {message}"`. **Never throws.**

## Dependencies & side effects

- `isMemoryDbAvailable()`, `getPool()`, `trackLatency('lore_query_graph', …)`.
- Query handler `queryLiveGraph` ([graph.ts](../../../libs/server-core/src/features/memory/graph.ts#L200)); population via `extractAndUpdateGraph` ([graph.ts](../../../libs/server-core/src/features/memory/graph.ts#L134)).
- Tables: `memory.entities` + `memory.edges` (read); `memory.audit_log` (latency insert via `trackLatency`).
- Env: `LORE_DB_HOST` (direct DB) **or** `LORE_API_URL` + `LORE_INGEST_TOKEN`
  (remote proxy via `GET /api/graph`).

## Acceptance Criteria

1. Entities and typed edges parse from the extractor's JSON output. ([validated by `graph.test.ts:47`](libs/server-core/src/features/memory/graph.test.ts#L5))

2. Entity names are normalized to lowercase so a query matches regardless of
   source casing. ([validated by `graph.test.ts:69`](libs/server-core/src/features/memory/graph.test.ts#L27))

3. A new edge with the same source+relation but a different target invalidates
   the prior edge. ([validated by `graph.test.ts:133`](libs/server-core/src/features/memory/graph.test.ts#L91))

4. An already-present exact edge is not re-inserted. ([validated by `graph.test.ts:192`](libs/server-core/src/features/memory/graph.test.ts#L150))

5. The live read query itself (`queryLiveGraph` SQL) has no unit seam.
   *(untested: requires live `memory.entities`/`memory.edges` rows; the
   population + parse paths are covered above.)*
6. In local stdio mode (no DB) the tool proxies to `GET /api/graph` with the
   query params and bearer token. ([validated by `memory-tools.test.ts:50`](apps/mcp-server/src/mcp/tools/memory-tools.test.ts#L50))

7. With no `LORE_API_URL` configured it returns the PostgreSQL-or-API-URL
   message rather than calling out. ([validated by `memory-tools.test.ts:72`](apps/mcp-server/src/mcp/tools/memory-tools.test.ts#L72))

7a. A 401/403 from the proxied `GET /api/graph` is reported as a denied error
    on the first attempt, without the retriable-status backoff loop.
    ([validated by `reports a denied error on a 403 without
    retrying`](apps/mcp-server/src/mcp/tools/memory-tools.test.ts#L219))

8. The `GET /api/graph` endpoint passes the params to `queryLiveGraph` and
   returns its rows, 503 without a pool, 500 on error. ([validated by `graph.test.ts:31`](apps/lore-api/src/api/routes/graph/graph.test.ts#L31))

9. The legacy file-based static graph search (`graphSearchHandler`) reports an
   unbuilt-graph message, a parse error, or a missing-fields error before
   falling back to entity matching and BFS traversal chains; a thrown error
   during that pass is reported as `Error reading graph: {message}` rather
   than propagating. ([validated by `graph-handlers.test.ts:27`](libs/server-core/src/features/memory/graph-handlers.test.ts#L27), [`graph-handlers.test.ts:34`](libs/server-core/src/features/memory/graph-handlers.test.ts#L34), [`graph-handlers.test.ts:42`](libs/server-core/src/features/memory/graph-handlers.test.ts#L42), [`graph-handlers.test.ts:55`](libs/server-core/src/features/memory/graph-handlers.test.ts#L55), [`graph-handlers.test.ts:71`](libs/server-core/src/features/memory/graph-handlers.test.ts#L71), [`graph-handlers.test.ts:93`](libs/server-core/src/features/memory/graph-handlers.test.ts#L93), [`graph-handlers.test.ts:107`](libs/server-core/src/features/memory/graph-handlers.test.ts#L107), [`graph-handlers.test.ts:212`](libs/server-core/src/features/memory/graph-handlers.test.ts#L212))

10. The legacy `getDomainSummaryHandler` mirrors the same not-built/parse/shape
    error precedence, then looks up a domain case-insensitively and lists
    available domains when no match is found. ([validated by `graph-handlers.test.ts:141`](libs/server-core/src/features/memory/graph-handlers.test.ts#L141), [`graph-handlers.test.ts:148`](libs/server-core/src/features/memory/graph-handlers.test.ts#L148), [`graph-handlers.test.ts:158`](libs/server-core/src/features/memory/graph-handlers.test.ts#L158), [`graph-handlers.test.ts:171`](libs/server-core/src/features/memory/graph-handlers.test.ts#L171), [`graph-handlers.test.ts:184`](libs/server-core/src/features/memory/graph-handlers.test.ts#L184))

## Out of Scope

- LLM entity extraction prompt accuracy.
- Graph augmentation in `lore_search_memory` (covered there).
