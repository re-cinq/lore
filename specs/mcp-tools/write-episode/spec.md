# Feature Specification: `lore_write_episode` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `lore_write_episode` MCP tool                         |
| Status  | **Draft**                                        |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `lore_write_episode`                                  |
| Module  | memory                                           |
| Scope   | shared                                           |

## Problem Statement

Curated `lore_write_memory` calls capture only what an agent decides to write down.
Most useful knowledge — conversation turns, code reviews, observations —
arrives as raw, unstructured text that no one will hand-curate. We need passive
capture: ingest the raw blob once, de-duplicate it, and let the system extract
individually-searchable facts and knowledge-graph entities from it
asynchronously, without leaking secrets into the org-wide store.

## Interface

Registered via `server.tool` ([registration](../../../mcp-server/src/mcp/tools/memory-tools.ts#L193)).

- **name**: `lore_write_episode`
- **description** (verbatim): *"Ingest raw, unstructured text (conversation
  turn, code review, observation). The system stores it as an episode and
  automatically extracts searchable facts. Use this for passive knowledge
  capture — no need to curate what's important."*

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `content` | string | yes | — | Raw text. `min(1).max(50000)`. |
| `source` | string | no | `"manual"` | Source tag: `session`, `pr-review`, `ci`, `manual`. |
| `ref` | string | no | — | External reference, e.g. `owner/repo#42`. |
| `agent_id` | string | no | — | Override the resolved agent ID. |

## Behavior

1. `dbPoolRef = getPool()`.
2. **Proxy path** — if **not** `isMemoryDbAvailable()`:
   - `proxyToApi("/api/episode", { content, source, ref, agent_id: agent_id ||
     resolveAgentId() })`. `ok` → `proxied.body`; `unreachable` →
     `unreachableError("lore_write_episode", detail)`; `not_configured` → literal
     `"Episodes require PostgreSQL or LORE_API_URL. Neither is configured."`
3. **DB path**:
   1. `agent = resolveAgentId(agent_id)`.
   2. `safeContent = sanitizeContent(content)` (`redactSecrets` — strips API
      keys, JWTs, private keys, connection strings, bearer tokens).
   3. `contentHash = sha256(safeContent)`; `embedding =
      getQueryEmbedding(safeContent)` → `[v,…]` string or null.
   4. `INSERT INTO memory.episodes (agent_id, content, content_hash, source,
      ref, embedding) VALUES (…) ON CONFLICT (agent_id, content_hash) DO NOTHING
      RETURNING id`.
   5. **Dedupe**: `rows.length === 0` → return
      `{"status":"duplicate","message":"Episode already ingested."}` (no
      extraction, no audit).
   6. New insert → `episodeId = rows[0].id`. Fire two best-effort async jobs
      (do not block the response):
      - `extractFactsFromEpisode(episodeId, content, agent, dbPoolRef)`
        ([facts](../../../mcp-server/src/features/memory/facts.ts#L213)) — LLM extract (≤10 facts via `parseFacts`), embed each,
        `INSERT INTO memory.facts (episode_id, …)`, then
        `invalidateContradictions` (cosine ≥ `LORE_FACT_SIMILARITY_THRESHOLD`
        default 0.92 sets `valid_to`/`invalidated_by` + writes
        `memory.fact_conflicts`). `.catch` logs a warning.
      - `repoFromRef = ref.match(/^([^#]+)/)?.[1] || null`; `graphLlmCall =
        createGraphLlmCall(dbPoolRef)`; `extractAndUpdateGraph(dbPoolRef,
        content, repoFromRef, episodeId, null, graphLlmCall)`
        ([graph](../../../mcp-server/src/features/memory/graph.ts#L119)) — upsert entities + temporally-invalidating
        edge upserts. `.catch` logs a warning.
   7. `INSERT INTO memory.audit_log (agent_id, operation='lore_write_episode',
      metadata={episode_id, source, ref})` (best-effort `.catch`).
   8. Return `{ status: "ok", episode_id, source, ref }`.
4. Any thrown error → `"Error writing episode: {message}"`.

## Output

A single MCP text content block. One of: `{"status":"ok","episode_id":…,
"source":…,"ref":…}`; `{"status":"duplicate","message":"Episode already
ingested."}`; the proxied body; the `unreachableError` message; the
`"Episodes require PostgreSQL or LORE_API_URL…"` text; or
`"Error writing episode: {message}"`. **Never throws.**

## Dependencies & side effects

- `getPool()`, `isMemoryDbAvailable()`, `resolveAgentId()`, `sanitizeContent`
  (`redactSecrets`), `getQueryEmbedding()`, `createGraphLlmCall`.
- Async: `extractFactsFromEpisode` ([facts.ts](../../../mcp-server/src/features/memory/facts.ts#L213)), `extractAndUpdateGraph` ([graph.ts](../../../mcp-server/src/features/memory/graph.ts#L119)).
- `proxyToApi` / `unreachableError` ([deps.ts](../../../mcp-server/src/mcp/tools/deps.ts#L62)).
- Tables: `memory.episodes` (insert, idempotent on `(agent_id, content_hash)`), `memory.facts` + `memory.fact_conflicts` (async), `memory.entities` + `memory.edges` (async), `memory.audit_log` (insert).
- Env: `LORE_DB_HOST`, `LORE_API_URL` + `LORE_INGEST_TOKEN`, `LORE_FACT_SIMILARITY_THRESHOLD`, LLM provider env (`LORE_LLM_PROVIDER` / `LORE_FACT_LLM`).

## Acceptance Criteria

1. Extracted facts parse from a JSON array of fact strings. ([validated by `parses a JSON array of strings`](../../../mcp-server/src/features/memory/facts.test.ts#L30))
2. Fact extraction caps at 10 facts per episode. ([validated by `limits to 10 facts`](../../../mcp-server/src/features/memory/facts.test.ts#L53))
3. A new fact that closely matches an existing one invalidates the old fact. ([validated by `invalidates high-similarity facts`](../../../mcp-server/src/features/memory/facts.test.ts#L123))
4. No invalidation happens when no similar fact exists. ([validated by `does nothing when no similar facts exist`](../../../mcp-server/src/features/memory/facts.test.ts#L144))

## Out of Scope

- The episode INSERT / dedupe / audit composed inline in the tool handler.
  *(untested: requires live `memory.episodes` + a content-hash conflict.)*
- Embedding generation and secret redaction (owned by their own modules).
- The graph-side projection (covered by the `lore_query_graph` spec).
- GKE-side `/api/episode` route handling.
