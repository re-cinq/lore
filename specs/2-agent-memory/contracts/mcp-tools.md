# MCP Tool Contracts: Agent Runtime Memory

All tools are registered via `@modelcontextprotocol/sdk` using
`server.tool()` with Zod input schemas. Responses follow the MCP
content format: `{ content: [{ type: 'text', text: string }] }`.

When `agent_id` is marked optional, the server resolves it from:
1. Explicit parameter on the call.
2. `LORE_AGENT_ID` environment variable.
3. `~/.lore/agent-id` file.
4. Auto-generated UUID (written to `~/.lore/agent-id`).

**Note on design vs. shipped:** `shared_write`, `shared_read`,
`create_snapshot`, `restore_snapshot`, and `agent_health` were in the
original design but are **not registered as MCP tools**. Their
backing functions exist in `memory.ts` but are internal only. Shared
pools are accessed via the `pool` parameter on `write_memory` and
`search_memory`. See plan.md §Architectural Pivots.

---

## Memory CRUD Tools

### write_memory

Write or update a key-value memory entry. If the key already exists,
a new version is created (previous version preserved in
`memory.memory_versions`). Privacy filter (`sanitizeContent()` /
`redactSecrets()`) runs before storage.

**Input:**
```typescript
{
  key: z.string(),
  value: z.string(),
  agent_id: z.string().optional(),
  ttl: z.number().optional(),        // TTL in seconds; NULL = permanent
  extract_facts: z.boolean().default(false),
  repo: z.string().optional()
}
```

**Response:**
```json
{
  "key": "user.preferences",
  "version": 2,
  "agent_id": "agent-abc123",
  "created_at": "2026-03-29T10:00:00Z"
}
```

**Behavior:**
1. Privacy filter strips API keys, JWTs, connection strings, bearer
   tokens from `value` before storage.
2. Embedding generated synchronously via Vertex AI text-embedding-005.
3. New row inserted in `memory.memories`; previous row written to
   `memory.memory_versions`.
4. If `extract_facts = true`, `extractFacts()` runs asynchronously
   (fire-and-forget; never blocks the write response; extracted facts
   carry `confidence = 'inferred'`).
5. TTL: `expires_at = NOW() + ttl * interval '1 second'` stored on write.
6. Audit entry written with `operation = 'write'`.

**Shared pools:** Pass `pool_id` (FK to `memory.shared_pools`) to
write into a named cross-agent pool. This is the replacement for the
unshipped `shared_write` tool.

---

### read_memory

Read a memory entry by key. Returns the latest version by default.

**Input:**
```typescript
{
  key: z.string(),
  agent_id: z.string().optional(),
  version: z.union([z.number(), z.literal('all')]).optional()
}
```

**Response (single version):**
```json
{
  "key": "user.preferences",
  "value": "Prefers concise answers, dark mode, metric units.",
  "version": 2,
  "created_at": "2026-03-29T10:00:00Z"
}
```

**Response (version="all"):** Array of version objects ordered by
version descending.

---

### delete_memory

Soft-delete. Sets `is_deleted = TRUE` on all versions of the key.
Version history preserved for audit; excluded from all reads and
searches.

**Input:**
```typescript
{
  key: z.string(),
  agent_id: z.string().optional()
}
```

**Response:** `{ "key": "user.preferences", "deleted": true }`

---

### list_memories

Paginated listing of active (non-deleted, non-expired) memories for
an agent.

**Input:**
```typescript
{
  agent_id: z.string().optional(),
  limit: z.number().default(50),
  offset: z.number().default(0)
}
```

**Response:**
```json
{
  "memories": [
    { "key": "user.preferences", "version": 2, "created_at": "..." }
  ],
  "total": 42
}
```

---

## Search Tool

### search_memory

Hybrid semantic + keyword search over an agent's memories and
extracted facts. Also searches shared pools when `pool` is specified.

**Input:**
```typescript
{
  query: z.string(),
  agent_id: z.string().optional(),
  pool: z.string().optional(),
  limit: z.number().default(10),
  include_invalidated: z.boolean().default(false),
  graph_augment: z.boolean().default(false)
}
```

`include_invalidated`: include facts superseded by newer contradicting
facts. Useful for historical queries.

`graph_augment`: enrich results with 1-hop knowledge graph neighbors
of entities detected in the query. Matched entities use an in-process
5-minute TTL cache. Graph-derived results receive lower RRF scores
than direct memory/fact hits.

**Response:** Array of `MemorySearchResult`:
```json
[
  {
    "key": "user.preferences",
    "value": "Prefers concise answers...",
    "score": 0.92,
    "agent_id": "agent-abc123",
    "source": "memory",
    "id": "550e8400-...",
    "confidence": "observed"
  }
]
```

`source` values: `"memory" | "fact" | "episode" | "graph"`

**Search pipeline:**
1. Generate embedding for `query`.
2. Vector search (HNSW `<=>`) over `memories.embedding` + `facts.embedding`.
3. Keyword search (ILIKE) as parallel path and fallback.
4. Reciprocal Rank Fusion (k=60) merges both ranked lists.
5. Session diversification: max 3 results per `(agent_id, source)` combo.
6. If `graph_augment = true`, append 1-hop entity neighbors.
7. Fire-and-forget async: increment `retrieval_count`, update
   `last_retrieved_at`, extend `half_life_days` (+2, cap 365) on
   every returned fact and memory. Stale facts revive to `observed`.
8. Audit entry written.

---

## Episode Tool

### write_episode

Ingest raw, unstructured text (conversation turn, code review, CI
output, observation). Fact extraction and knowledge graph update run
asynchronously. SHA-256 content-hash deduplication prevents
re-ingestion of identical content.

**Input:**
```typescript
{
  content: z.string().min(1).max(50000),
  source: z.string().default("manual"),   // "session" | "pr-review" | "ci" | "manual"
  ref: z.string().optional(),             // e.g. "owner/repo#42"
  agent_id: z.string().optional()
}
```

Note: the parameter is `content`, not `text` (the spec.md prose uses
"text" loosely — the registered tool schema uses `content`).

**Response (new episode):**
```json
{ "status": "ok", "episode_id": "...", "source": "session", "ref": "owner/repo#42" }
```

**Response (duplicate):**
```json
{ "status": "duplicate", "message": "Episode already ingested." }
```

**Async pipeline (after response returns):**
1. `extractFactsFromEpisode()` — LLM-driven fact extraction;
   facts stored with `confidence = 'observed'` (default DB value).
2. `extractAndUpdateGraph()` — entity + edge extraction via LLM;
   up to 10 entities and 10 edges per episode; entity names
   normalized to lowercase; contradictory edges invalidated.

If no `ANTHROPIC_API_KEY` is set, the async pipeline falls back to
`claude --print` (CLI subscription path, no API credits consumed).

`ref` is used to derive the repo scope for graph extraction
(pattern: `owner/repo#N` → repo = `owner/repo`).

---

## Knowledge Graph Tool

### query_graph

Query the live knowledge graph (PostgreSQL `memory.entities` +
`memory.edges`) for entities and their relationships. Replaces the
static `graphrag/graph.json`.

**Input:**
```typescript
{
  entity: z.string().optional(),
  relation_type: z.string().optional(),   // "uses" | "owns" | "depends-on" | "replaced-by" | "part-of" | "implements"
  repo: z.string().optional(),
  include_invalidated: z.boolean().default(false)
}
```

All parameters are optional. Omitting `entity` returns recent edges
across the graph.

Note: the original design specified a `depth` parameter. The shipped
implementation does not have `depth` — use multiple calls to
traverse multi-hop paths. `relation_type` and `repo` filtering were
added in its place.

**Response:** Array of `LiveGraphResult`:
```json
[
  {
    "entity": "auth-service",
    "entity_type": "service",
    "relation": "depends-on",
    "related_entity": "postgres",
    "related_type": "technology",
    "direction": "outgoing",
    "valid_from": "2026-03-29T10:00:00Z"
  }
]
```

`direction`: `"outgoing"` (entity → related) or `"incoming"`
(related → entity).

---

## Monitoring Tool

### agent_stats

Returns a merged view of agent health, usage statistics, and recent
episode activity. Combines what was originally two separate tools
(`agent_health` + `agent_stats`) plus episode summary in a single
call.

**Input:**
```typescript
{
  agent_id: z.string().optional()
}
```

**Response:**
```json
{
  "agent_id": "agent-abc123",
  "memory_count": 42,
  "last_active": "2026-03-29T10:00:00Z",
  "snapshot_count": 0,
  "status": "healthy",
  "total_memories": 42,
  "total_facts": 138,
  "active_facts": 120,
  "invalidated_facts": 18,
  "total_searches": 89,
  "shared_pools_created": 0,
  "recent_episodes": {
    "total_count": 15,
    "latest": [
      {
        "id": "...",
        "source": "session",
        "ref": "owner/repo#42",
        "created_at": "...",
        "content_preview": "First 200 chars...",
        "fact_count": 7
      }
    ]
  }
}
```

`snapshot_count` and `shared_pools_created` are always `0` —
snapshot/shared-pool MCP tools were not shipped.

`status` values: `"healthy"` (active within 24h), `"idle"` (active
but no recent activity), `"empty"` (no memories).

The `recent_episodes.latest` array includes up to 5 most recent
episodes with a 200-character content preview and the count of facts
extracted from each.

---

## Context Assembly Tool

### assemble_context

Retrieve and assemble context from all sources (repo chunks, ADRs,
memories, facts, episodes, knowledge graph) into a single
token-budgeted block. The primary entry point for agents starting a
new task — replaces calling `search_context` + `search_memory` +
`get_adrs` individually.

**Input:**
```typescript
{
  query: z.string(),
  template: z.string().default("default"),   // "default" | "review" | "implementation" | "research"
  max_tokens: z.number().default(8000),      // min 2000; research template supports up to 16000
  repo: z.string().optional(),
  agent_id: z.string().optional(),
  cross_repo: z.boolean().default(false)
}
```

`cross_repo`: include context from repos linked via
`settings.cross_repo_repos`. Transfer scoring (portable vs. local
keyword filter, score ≥ 0.5 threshold) prevents repo-specific
config from polluting results.

Template token budgets: `research` keeps 16K; `implementation`,
`review`, and `default` cap at 8K.

---

## Tools NOT Shipped as MCP

The following tools from the original design have backing
implementation in `mcp-server/src/memory.ts` but are **not
registered** in `index.ts` and are **not callable by agents**:

| Original Tool    | Status         | Workaround                                  |
|------------------|----------------|---------------------------------------------|
| `shared_write`   | Not registered | Use `write_memory` with `pool_id` parameter |
| `shared_read`    | Not registered | Use `search_memory` with `pool` parameter   |
| `create_snapshot`| Not registered | Internal function; no external use case yet |
| `restore_snapshot`| Not registered | Internal function; not needed in practice   |
| `agent_health`   | Not registered | Data folded into `agent_stats` response     |
