# MCP Tool Contracts: Agent Runtime Memory

All tools are registered via `@modelcontextprotocol/sdk` using
`server.tool()` with Zod input schemas. Responses follow the MCP
content format: `{ content: [{ type: 'text', text: string }] }`.
The `text` field contains either a JSON payload or a plain-text error
message (always prefixed `"Error …"` so callers can distinguish).

When `agent_id` is marked optional, it is resolved from the
`LORE_AGENT_ID` env, `~/.lore/agent-id` file, or auto-generated UUID.

> **Updated 2026-06-01.** The original contract file described five
> tools that were never shipped as MCP tools (`shared_write`,
> `shared_read`, `create_snapshot`, `restore_snapshot`, `agent_health`).
> This revision documents the seven tools that are actually registered,
> plus `assemble_context` which was added post-design. See
> [spec.md § Divergences](../spec.md#divergences-from-original-design).

---

## Memory CRUD

### write_memory

Store a key-value memory scoped to the current repo. If the key already
exists, a new version is created and the previous version is preserved in
`memory_versions`.

**Input:**
```typescript
{
  key: z.string()
    .describe('Memory key (e.g. "auth-pattern", "session-summary/2026-03-30").'),
  value: z.string()
    .describe('Memory value (free-form text, embedded async).'),
  agent_id: z.string().optional()
    .describe('Override agent ID.'),
  ttl: z.number().optional()
    .describe('Time-to-live in seconds. Omit for permanent.'),
  extract_facts: z.boolean().optional()
    .describe('If true, asynchronously extract atomic facts from value.')
}
```

**Response:**
```json
{
  "key": "auth-pattern",
  "version": 2,
  "agent_id": "agent-abc123",
  "created_at": "2026-03-29T10:00:00Z"
}
```

**Behavior:**
1. Resolve `agent_id`; detect repo from git remote.
2. Look up current max version for `(repo ?? agent_id, key)`.
3. `UPDATE` existing row (increment version) or `INSERT` new row.
4. Mirror the write to `memory_versions` (always).
5. Enqueue async embedding generation.
6. If `extract_facts=true`, enqueue async fact extraction via `facts.ts`.
7. Write an `audit_log` entry with `operation='write'`.

**Error conditions:**
- Value exceeds 100KB: `"value exceeds maximum size"`.
- DB unavailable: proxies to `LORE_API_URL` if configured; falls back to
  file-based storage at `~/.lore/memory/` in true offline mode.

---

### read_memory

Retrieve a memory by key. Returns the latest version by default.

**Input:**
```typescript
{
  key: z.string(),
  agent_id: z.string().optional(),
  version: z.string().optional()
    .describe('"all" for full history, or specific version number as string.')
}
```

**Response (latest version):**
```json
{
  "key": "auth-pattern",
  "value": "Use JWT RS256 with a 15-minute expiry.",
  "version": 2,
  "created_at": "2026-03-29T10:00:00Z"
}
```

**Response (version="all"):**
```json
[
  { "version": 2, "value": "Use JWT RS256 …", "created_at": "…" },
  { "version": 1, "value": "Use sessions …", "created_at": "…" }
]
```

**Behavior:**
- `version="all"` queries `memory_versions` ordered by version descending.
- Specific version queries `memory_versions` by exact version number.
- Latest queries `memory.memories` directly (fastest path).
- Excludes `is_deleted=true` and expired rows.
- Writes `audit_log` entry with `operation='read'`.

**Error conditions:**
- Key not found: `"Memory \"{key}\" not found."` (plain text, not JSON).

---

### delete_memory

Soft-delete a memory. Sets `is_deleted=true` on the live row. The entry
is excluded from all reads and searches but remains for audit and version
history.

**Input:**
```typescript
{
  key: z.string(),
  agent_id: z.string().optional()
}
```

**Response:**
```json
{ "key": "auth-pattern", "deleted": true }
```

**Behavior:**
1. Resolve `agent_id`.
2. Set `is_deleted=true` on the latest version of `(agent_id, key)`.
3. Write `audit_log` entry with `operation='delete'`.

**Error conditions:**
- Key not found: returns error string.

---

### list_memories

List active memory keys for the current repo, with pagination.

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
    { "key": "auth-pattern", "version": 2, "created_at": "…" },
    { "key": "session-summary/2026-03-30", "version": 1, "created_at": "…" }
  ],
  "total": 42
}
```

**Behavior:**
- Queries latest version of each distinct key WHERE `repo` matches
  (or `agent_id` if no repo), `is_deleted=false`, and not expired.
- Returns total count of active keys alongside the page.
- No results: `{ memories: [], total: 0 }` (not an error).

---

## Semantic Search

### search_memory

Hybrid semantic + keyword search across all org memories and extracted
facts. Uses Reciprocal Rank Fusion (k=60) to merge four parallel result
sets: vector search on memories, vector search on facts, keyword search
on memories, keyword search on facts.

**Input:**
```typescript
{
  query: z.string()
    .describe('Natural language search query.'),
  agent_id: z.string().optional()
    .describe('Scope to agent. Omit for cross-agent search.'),
  pool: z.string().optional()
    .describe('Include memories from this shared pool (resolved to pool_id).'),
  limit: z.number().default(10),
  include_invalidated: z.boolean().default(false)
    .describe('Include facts superseded by later contradictions. Useful for historical queries.'),
  graph_augment: z.boolean().default(false)
    .describe('Enrich results with 1-hop knowledge graph neighbors of detected entities.')
}
```

**Response:**
```json
[
  {
    "key": "auth-pattern",
    "value": "Use JWT RS256 with a 15-minute expiry.",
    "score": 0.92,
    "agent_id": "agent-abc123",
    "source": "memory",
    "id": "550e8400-…",
    "confidence": "observed"
  },
  {
    "key": null,
    "value": "JWT tokens expire after 15 minutes to limit session hijacking risk.",
    "score": 0.78,
    "agent_id": "agent-abc123",
    "source": "fact",
    "id": "660e8400-…",
    "confidence": "observed"
  }
]
```

`source` is one of `"memory"`, `"fact"`, `"episode"`, `"graph"`.
`confidence` appears on fact results: `verified`, `observed`, `inferred`,
or `stale`.

**Key behaviors:**
- **Session diversification:** results are capped at 3 per
  `(agent_id, source)` combination to prevent verbose sessions from
  dominating the result set.
- **Retrieval strengthening (fire-and-forget):** every hit increments
  `retrieval_count`, updates `last_retrieved_at`, and extends
  `half_life_days` (+2, capped at 365) on the returned facts and
  memories. Stale facts are revived to `observed` confidence.
- **Graph augmentation:** when `graph_augment=true`, detected entities
  in top results are used to fetch 1-hop graph neighbors, appended with
  a halved score penalty.
- Only currently-valid facts (`valid_to IS NULL`) are returned by
  default. Set `include_invalidated=true` for historical queries.
- Falls back to keyword-only search when Vertex AI embeddings are
  unavailable.

---

## Episode Ingestion

### write_episode

Ingest raw, unstructured text (conversation turn, code review,
observation). Stores as an `episode` row and triggers asynchronous fact
extraction and knowledge-graph update. The caller does not need to
structure or curate the input.

**Input:**
```typescript
{
  content: z.string().min(1).max(50000)
    .describe('Raw text to ingest.'),
  source: z.string().default('manual')
    .describe('Source tag: "session", "pr-review", "ci", "manual".'),
  ref: z.string().optional()
    .describe('External reference, e.g. "owner/repo#42".'),
  agent_id: z.string().optional()
    .describe('Override agent ID.')
}
```

**Response (new episode):**
```json
{
  "status": "ok",
  "episode_id": "770e8400-e29b-41d4-a716-446655440000",
  "source": "pr-review",
  "ref": "re-cinq/lore#42"
}
```

**Response (duplicate):**
```json
{
  "status": "duplicate",
  "message": "Episode already ingested."
}
```

**Behavior:**
1. Pass content through `sanitizeContent()` / `redactSecrets()` before
   storage (strips API keys, JWTs, connection strings, bearer tokens).
2. Compute SHA-256 hash; `INSERT … ON CONFLICT DO NOTHING` deduplicates.
3. If new: enqueue async `extractFactsFromEpisode` and
   `extractAndUpdateGraph` (both best-effort, non-blocking).
4. Write `audit_log` entry with `operation='write_episode'`.

Requires PostgreSQL. Proxies to `LORE_API_URL` if DB is unavailable.
No file-backed fallback for episodes.

---

## Knowledge Graph

### query_graph

Query the live knowledge graph for entities and their typed
relationships. Returns results for both directions (outgoing and
incoming edges) filtered by the optional constraints.

**Input:**
```typescript
{
  entity: z.string().optional()
    .describe('Entity name to query. Omit to browse recent edges.'),
  relation_type: z.string().optional()
    .describe('Filter by relation: "uses", "owns", "depends-on", "replaced-by", "part-of", "implements".'),
  repo: z.string().optional()
    .describe('Scope to a specific repo.'),
  include_invalidated: z.boolean().default(false)
    .describe('Include historical (invalidated) relationships.')
}
```

**Response:**
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
  },
  {
    "entity": "auth-service",
    "entity_type": "service",
    "relation": "owns",
    "related_entity": "platform-team",
    "related_type": "team",
    "direction": "incoming",
    "valid_from": "2026-04-01T08:00:00Z"
  }
]
```

**Behavior:**
- Requires PostgreSQL (`LORE_DB_HOST`). No file-backed fallback.
- When `entity` is omitted, returns the most recent edges across all
  entities (useful for graph browsing).
- By default excludes edges where `valid_to IS NOT NULL`. Set
  `include_invalidated=true` to see the full relationship history.
- Empty result: `"No relationships found for \"{entity}\"."` or
  `"Knowledge graph is empty. …"` (plain text, not JSON).

---

## Observability

### agent_stats

Returns comprehensive statistics merged from health, usage, and recent
episode data. Combines `agentHealth` + `agentStats` + recent episodes in
a single call to avoid multiple round trips.

**Input:**
```typescript
{
  agent_id: z.string().optional()
}
```

**Response (illustrative shape — exact keys depend on DB data):**
```json
{
  "agent_id": "agent-abc123",
  "memory_count": 42,
  "last_active": "2026-03-29T10:00:00Z",
  "snapshot_count": 0,
  "status": "healthy",
  "total_memories": 42,
  "active_facts": 187,
  "invalidated_facts": 13,
  "total_searches": 89,
  "shared_pool_count": 0,
  "daily_breakdown": [
    { "date": "2026-03-29", "writes": 12, "reads": 5, "searches": 8 }
  ],
  "recent_episodes": {
    "total_count": 23,
    "latest": [
      {
        "id": "770e8400-…",
        "source": "pr-review",
        "ref": "re-cinq/lore#42",
        "created_at": "2026-03-29T10:00:00Z",
        "content_preview": "Reviewed auth middleware changes…",
        "fact_count": 5
      }
    ]
  }
}
```

Note: `snapshot_count` and `shared_pool_count` are always `0` — no MCP
tools for creating snapshots or named pools are shipped; those fields are
retained for forward compatibility.

**Behavior:**
- Requires PostgreSQL. Returns an error string if DB is unavailable.
- Runs three queries in parallel: health, stats, recent episodes (last 5,
  capped at 200 chars preview each).
- `status` is `"healthy"` (active within 24h), `"idle"` (>24h), or
  `"empty"` (no memories at all).

---

## Context Assembly

### assemble_context

Retrieve and assemble context from all sources — repo conventions, ADRs,
memories, facts, episodes, graph — into a single structured block
optimized for LLM consumption. The primary entry-point tool; replaces
chaining `search_context`, `search_memory`, and `get_adrs` separately.

**Input:**
```typescript
{
  query: z.string()
    .describe('What context is needed (e.g. "implement auth middleware").'),
  template: z.string().default('default')
    .describe('Template: "default", "review", "implementation", "research".'),
  max_tokens: z.number().default(8000)
    .describe('Token budget (min 2000; research template typically needs ~16000).'),
  repo: z.string().optional()
    .describe('"owner/repo". Auto-detected from git remote if omitted.'),
  agent_id: z.string().optional(),
  cross_repo: z.boolean().default(false)
    .describe('Include context from repos linked via settings.cross_repo_repos.')
}
```

**Response:**

A structured prose block prefixed with an HTML comment carrying metadata:

```
<!-- context: template=default, sections=7, tokens=6241 -->

## Conventions
…
## ADRs
…
## Memories
…
```

**Behavior:**
- Template selects context ordering and token allocation (see
  `mcp-server/templates/`).
- Memories and facts that have recent `fact_conflicts` entries are
  prefixed `[CONFLICT]` in the output.
- Stale context warning (>7 days since last ingest) is included when
  applicable.
- Proxies to `LORE_API_URL` when DB is unavailable.
- No result: `"No relevant context found for this query."`.

---

## Not Shipped

The following tools were specified in the original design but were
**not registered as MCP tools** in the shipped implementation. Internal
functions exist in `memory.ts` for some of these.

| Specified Tool     | Workaround                                                |
|--------------------|-----------------------------------------------------------|
| `shared_write`     | `write_memory` with `pool=<name>` parameter              |
| `shared_read`      | `search_memory` with `pool=<name>` parameter             |
| `create_snapshot`  | Internal only; no MCP exposure                           |
| `restore_snapshot` | Internal only; no MCP exposure                           |
| `agent_health`     | Data subsumed by `agent_stats`                           |
