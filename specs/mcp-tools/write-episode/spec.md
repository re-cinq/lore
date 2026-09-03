# Feature Specification: `lore_write_episode` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `lore_write_episode` MCP tool                         |
| Status  | In Progress                                      |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `lore_write_episode`                                  |
| Module  | memory                                           |
| Scope   | shared                                           |

`lore_write_episode` ingests one raw uncurated text blob as a deduplicated, secret-redacted episode from which facts and knowledge-graph entities are extracted asynchronously.

## Problem Statement

Curated `lore_write_memory` calls capture only what an agent decides to write down.
Most useful knowledge — conversation turns, code reviews, observations —
arrives as raw, unstructured text that no one will hand-curate. We need passive
capture: ingest the raw blob once, de-duplicate it, and let the system extract
individually-searchable facts and knowledge-graph entities from it
asynchronously, without leaking secrets into the org-wide store.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/memory-tools.ts#L193)).

- **name**: `lore_write_episode`
- **description** (verbatim):

```text
Ingests one raw uncurated text blob as a deduplicated episode; returns {status: "ok", episode_id, source, ref} or {status: "duplicate"} when already ingested. Content is secret-redacted; facts and graph entities/edges are extracted asynchronously. Use for bulk/passive capture where you do not want to choose a key and do not need the text individually addressable. Instead: lore_write_memory for a curated nugget you want to retrieve by a specific key. No file fallback — requires DB or API.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `content` | string | yes | — | Raw text to ingest; deduplicated by content hash. 1–50000 chars. |
| `source` | string | no | `"manual"` | Provenance tag, e.g. "session", "pr-review", "ci". |
| `ref` | string | no | — | External reference, e.g. "owner/repo#42". The owner/repo prefix scopes graph entities. |
| `agent_id` | string | no | — | — |

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
        ([facts](../../../libs/server-core/src/features/memory/facts.ts#L260)) — LLM extract (≤10 facts via `parseFacts`), embed each,
        `INSERT INTO memory.facts (episode_id, …)`, then
        `invalidateContradictions` (cosine ≥ `LORE_FACT_SIMILARITY_THRESHOLD`
        default 0.92 sets `valid_to`/`invalidated_by` + writes
        `memory.fact_conflicts`). `.catch` logs a warning.
      - `repoFromRef = ref.match(/^([^#]+)/)?.[1] || null`; `graphLlmCall =
        createGraphLlmCall(dbPoolRef)`; `extractAndUpdateGraph(dbPoolRef,
        content, repoFromRef, episodeId, null, graphLlmCall)`
        ([graph](../../../libs/server-core/src/features/memory/graph.ts#L134)) — upsert entities + temporally-invalidating
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
- Async: `extractFactsFromEpisode` ([facts.ts](../../../libs/server-core/src/features/memory/facts.ts#L260)), `extractAndUpdateGraph` ([graph.ts](../../../libs/server-core/src/features/memory/graph.ts#L134)).
- `proxyToApi` / `unreachableError` ([deps.ts](apps/mcp-server/src/mcp/tools/deps.ts#L62)).
- Tables: `memory.episodes` (insert, idempotent on `(agent_id, content_hash)`), `memory.facts` + `memory.fact_conflicts` (async), `memory.entities` + `memory.edges` (async), `memory.audit_log` (insert).
- Env: `LORE_DB_HOST`, `LORE_API_URL` + `LORE_INGEST_TOKEN`, `LORE_FACT_SIMILARITY_THRESHOLD`, LLM provider env (`LORE_LLM_PROVIDER` / `LORE_FACT_LLM`).

## Acceptance Criteria

1. Extracted facts parse from a JSON array of fact strings. ([validated by `parses a JSON array of strings`](libs/server-core/src/features/memory/facts.test.ts#L29))

2. Fact extraction caps at 10 facts per episode. ([validated by `limits to 10 facts`](libs/server-core/src/features/memory/facts.test.ts#L56))

3. A new fact that closely matches an existing one invalidates the old fact. ([validated by `invalidates high-similarity facts`](libs/server-core/src/features/memory/facts.test.ts#L95))

4. No invalidation happens when no similar fact exists. ([validated by `does nothing when no similar facts exist`](libs/server-core/src/features/memory/facts.test.ts#L128))

## Out of Scope

- The episode INSERT / dedupe / audit composed inline in the tool handler.
  *(untested: requires live `memory.episodes` + a content-hash conflict.)*
- Embedding generation and secret redaction (owned by their own modules).
- The graph-side projection (covered by the `lore_query_graph` spec).
- GKE-side `/api/episode` route handling.
