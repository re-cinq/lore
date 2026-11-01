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

Registered via `server.tool` ([registration](apps/mcp-server/src/transport/tools/memory/memory-tools.ts)).

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
   ([handler](../../../libs/shared/src/outbound/project/knowledge/memory-search.ts), re-export of
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
   7. `weightByConfidence(merged)` — scales each fused score by how much its
      tier is trusted (`verified`/`observed` 1, `inferred` 0.9, `stale` 0.6) and
      re-sorts. A `stale` fact means nothing has retrieved it in 30 days, which
      is evidence about the memory rather than about the query, so the tier
      breaks ties rather than deciding them: a stale fact that outscores an
      observed one outright still wins. A result with no tier at all is treated
      as `observed`, since a memory carries none and must not be penalised for
      it. ([validated by `sorts a stale fact below an observed one it narrowly outscored`](libs/shared/src/domain/memory-ranking.test.ts#L101), [`leaves a stale fact on top when it outscores an observed one outright`](libs/shared/src/domain/memory-ranking.test.ts#L107), [`treats a missing confidence as observed rather than penalising it`](libs/shared/src/domain/memory-ranking.test.ts#L113))
   8. `diversify(weighted, limit)` — caps per `agent_id::source` (max 3 each),
      then slices to `limit`. ([validated by `memory-ranking.test.ts:130`](libs/shared/src/domain/memory-ranking.test.ts#L156))
   9. `normalizeMemoryScores(kept)` — rescales so the top result is 1 and the
      rest are proportional fractions. Raw RRF sums sit near `1/61` and differ
      in the third decimal, so an unrelated hit read as all but tied with the
      best one and a caller could not tell a strong match from a weak one. The
      ordering is unchanged; only the spread becomes legible. ([validated by `rescales 0.0328 and 0.0265 to 1 and the fraction between them`](libs/shared/src/domain/memory-ranking.test.ts#L123), [`returns an empty list unchanged rather than dividing by zero`](libs/shared/src/domain/memory-ranking.test.ts#L136))
   10. **Graph augment** (when `graph_augment` and results non-empty):
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
- Engine `searchMemories` ([memory-search.ts](../../../libs/shared/src/outbound/project/knowledge/memory-search.ts)); ranking core `rrfMerge` / `diversify` in `@re-cinq/lore-shared`.
- `proxyMemory` / `unreachableError` ([deps.ts](../../../apps/mcp-server/src/transport/tools/shared/deps.ts#L16)); `searchMemoryFile` (offline).
- Tables: `memory.memories`, `memory.facts`, `memory.shared_pools`, `memory.entities`, `memory.edges` (reads); `memory.facts` / `memory.memories` (retrieval-strengthening updates); `memory.audit_log` (insert, `operation='search'`).
- Env: `LORE_DB_HOST`, `LORE_API_URL` + `LORE_INGEST_TOKEN`.

## Acceptance Criteria

1. A `pool` argument is resolved to a pool id by name before any search runs. ([validated by `memory-search.test.ts:29`](libs/shared/src/outbound/project/knowledge/memory-search.test.ts#L29))

2. When the named pool does not exist, search short-circuits to an empty
   result. ([validated by returns empty when the named pool does not exist](libs/shared/src/outbound/project/knowledge/memory-search.test.ts#L298))

3. RRF rank fusion carries each candidate's confidence onto the fused result. ([validated by `memory-ranking.test.ts:13`](libs/shared/src/domain/memory-ranking.test.ts#L13))

4. Diversification slices the total output to the requested limit across all
   sources. ([validated by `memory-ranking.test.ts:149`](libs/shared/src/domain/memory-ranking.test.ts#L175))

5. Cross-repo candidates are ranked by a case-insensitive transfer score that
   starts at 0.5, adds 0.15 per portable keyword and subtracts 0.15 per local
   keyword, clamped to `[0, 1]` — so portable-rich text scores above the 0.5
   passthrough threshold and local/mixed text is filtered out. ([validated by `transfer-score.test.ts:74`](apps/mcp-server/src/work/context/transfer-score.test.ts#L35), [validated by `transfer-score.test.ts:96`](apps/mcp-server/src/work/context/transfer-score.test.ts#L57), [validated by `transfer-score.test.ts:104`](apps/mcp-server/src/work/context/transfer-score.test.ts#L65))

6. *(added 2026-10-16, ADR-052 amendment "reads choose a backend")* An optional
   `backend` param (`lore`, `utopia`, `both`) is sent with the `search` action of
   `POST /api/memory`; with no API configured, `utopia` and `both` are refused
   rather than answered from the local file store. ([validated by forwards backend both to POST /api/memory and prints the API's answer](apps/mcp-server/src/transport/tools/memory/memory-tools.test.ts#L431), [validated by refuses backend utopia instead of searching the local file store when no API is configured](apps/mcp-server/src/transport/tools/memory/memory-tools.test.ts#L455))

7. The `search` action answers `utopia` with Utopia's memory and episode hits as `{ results, notes: [] }` where the deployment reads Utopia and a base holds a memory source, else `{ results: [], notes: ["search_memory: no Utopia reader yet"] }`, in both cases without searching Lore; `both` with Lore's hits labelled `lore` then Utopia's labelled `utopia`; an unknown backend with 400; a Lore search answers the bare hit list as before. A search naming no backend follows the repo's `settings.context_backend`, then `utopia` (2026-10-28). ([validated by answers no hits and a no-reader note when the search names no backend, without searching Lore](apps/lore-api/src/transport/routes/memory/memory.test.ts#L485), [validated by answers no hits and a no-reader note for backend utopia, without searching Lore](apps/lore-api/src/transport/routes/memory/memory.test.ts#L498), [validated by answers Lore's hits plus the no-reader note for backend both](apps/lore-api/src/transport/routes/memory/memory.test.ts#L511), [validated by returns 400 for a search backend of dgraph](apps/lore-api/src/transport/routes/memory/memory.test.ts#L522), [validated by answers Utopia's memory hits and no note for backend utopia when the deployment reads Utopia](apps/lore-api/src/transport/routes/memory/memory.test.ts#L543), [validated by answers Lore's hits labelled lore then Utopia's for backend both](apps/lore-api/src/transport/routes/memory/memory.test.ts#L560), [validated by keeps the no-reader note when the Utopia arm finds no base with a memory source](apps/lore-api/src/transport/routes/memory/memory.test.ts#L574), [validated by answers Lore's bare hit list when the repo o/r pins context_backend lore and the search names no backend](apps/lore-api/src/transport/routes/memory/memory.test.ts#L609), [validated by forwards repo, agent_id and limit to the Utopia arm](apps/lore-api/src/transport/routes/memory/memory.test.ts#L589))

8. Both search routes share one rule: Lore's hits unless only Utopia was asked for, Utopia's through the route's arm when it has one, and a note for the source while it has none. ([validated by returns Lore's hits and no notes for backend lore](libs/shared/src/domain/knowledge-backend.test.ts#L21), [validated by returns no hits and a no-reader note for backend utopia, never reading Lore](libs/shared/src/domain/knowledge-backend.test.ts#L28), [validated by returns Lore's hits plus the no-reader note for backend both](libs/shared/src/domain/knowledge-backend.test.ts#L39), [validated by returns Utopia's hits and no notes for backend utopia with a Utopia arm](libs/shared/src/domain/knowledge-backend.test.ts#L48), [validated by returns Lore's hits then Utopia's and no notes for backend both with a Utopia arm](libs/shared/src/domain/knowledge-backend.test.ts#L61), [validated by returns Lore's hits only and never reads the Utopia arm for backend lore](libs/shared/src/domain/knowledge-backend.test.ts#L70))

9. `memoryExternalId` and `utopiaMemoryHits` read a pushed `memory:<agent>/<key>` or `episode:<id>` document back as a memory hit scored by its best-ranked chunk: the memories source's chunks of one document are joined in order, the key line is removed, and other sources and other agents are dropped; `normalizeHitScores` scales a ranking so its best hit is 1. ([validated by parses memory:claude-bogdan/deployment-gotchas-2026-10-19 into agent claude-bogdan and that key](libs/shared/src/outbound/project/knowledge/memory-search-utopia.test.ts#L34), [validated by maps a memories-source hit to {key, agent_id, source memory, backend utopia} with the key line removed from the value](libs/shared/src/outbound/project/knowledge/memory-search-utopia.test.ts#L69), [validated by drops a hit of another source and a doc: id](libs/shared/src/outbound/project/knowledge/memory-search-utopia.test.ts#L110), [validated by drops memories of other agents and every episode when agentId claude-bogdan is asked for](libs/shared/src/outbound/project/knowledge/memory-search-utopia.test.ts#L119), [validated by joins two chunks of one memory in seq order and scores the document by its best-ranked chunk](libs/shared/src/outbound/project/knowledge/memory-search-utopia.test.ts#L131), [validated by scales scores 0.9 and 0.45 to 1 and 0.5](libs/shared/src/outbound/project/knowledge/memory-search-utopia.test.ts#L172), [validated by parses episode:abc-123 into episode id abc-123](libs/shared/src/outbound/project/knowledge/memory-search-utopia.test.ts#L44), [validated by returns null for doc:specs/x/spec.md](libs/shared/src/outbound/project/knowledge/memory-search-utopia.test.ts#L51), [validated by keeps a slash inside the key: memory:a/consolidated/re-cinq/lore/2026 has key consolidated/re-cinq/lore/2026](libs/shared/src/outbound/project/knowledge/memory-search-utopia.test.ts#L55), [validated by maps an episodes-source hit to {key episode-<id>, id, source episode, agent_id empty}](libs/shared/src/outbound/project/knowledge/memory-search-utopia.test.ts#L90), [validated by cuts to the limit after grouping](libs/shared/src/outbound/project/knowledge/memory-search-utopia.test.ts#L150), [validated by answers no hits when the base has no sources yet](libs/shared/src/outbound/project/knowledge/memory-search-utopia.test.ts#L162), [validated by leaves no hits as no hits](libs/shared/src/outbound/project/knowledge/memory-search-utopia.test.ts#L187))

10. The reader searches the repo's base when the search names a repo and the org's `<org>/memory` base, each through the knowledge base of its stored `memories` and `episodes` sources and never creating one, ranks the bases' hits together and cuts them to the limit; with no base holding a source it answers null and the route keeps the no-reader note. ([validated by searches the repo base kb-repo and the org base kb-org for re-cinq/lore and answers both bases' hits best first](apps/lore-api/src/work/utopia/memory/utopia-memory-search.test.ts#L102), [validated by searches only the org base when the search names no repo](apps/lore-api/src/work/utopia/memory/utopia-memory-search.test.ts#L129), [validated by skips a base with no stored source and answers null when none has one](apps/lore-api/src/work/utopia/memory/utopia-memory-search.test.ts#L142), [validated by keeps only hits of the base's own source ids](apps/lore-api/src/work/utopia/memory/utopia-memory-search.test.ts#L154), [validated by cuts the merged answer to the limit](apps/lore-api/src/work/utopia/memory/utopia-memory-search.test.ts#L171), [validated by searches the repo base once when the org names no GITHUB_ORG](apps/lore-api/src/work/utopia/memory/utopia-memory-search.test.ts#L204))

11. `lore_search_memory` sends the repo the call names with the search, validated as owner/name before any API call; a call in the agent gateway that names none searches org-wide. ([validated by forwards the repo re-cinq/lore the call names with the search to POST /api/memory](apps/mcp-server/src/transport/tools/memory/memory-tools.test.ts#L497), [validated by searches org-wide when the gateway call names no repo](apps/mcp-server/src/transport/tools/memory/memory-tools.test.ts#L511), [validated by refuses the repo ../lore before any API call](apps/mcp-server/src/transport/tools/memory/memory-tools.test.ts#L517))

## Out of Scope

- Vector embedding generation (owned by the embedding service).
- Retrieval strengthening side-effects (`retrieval_count` / `half_life_days`).
- File-backed fallback search (`searchMemoryFile`).
- GKE-side `/api/memory` route handling.
