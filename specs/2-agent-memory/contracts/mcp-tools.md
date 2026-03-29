# MCP Tool Contracts: Agent Runtime Memory

All tools are registered via `@modelcontextprotocol/sdk` using
`server.tool()` with Zod input schemas. Responses follow the MCP
content format: `{ content: [{ type: 'text', text: string }] }`.

When `agent_id` is marked optional, the server resolves it from the
authenticated session context. If no session context is available and
`agent_id` is omitted, the tool returns an error.

---

## Private Memory Tools

### write_memory

Write or update a key-value memory entry for an agent. If the key
already exists, a new version is created (the previous version is
preserved). Optionally extracts atomic facts asynchronously.

**Input:**
```typescript
{
  key: z.string()
    .describe('Memory key. Use namespaced keys (e.g., "user.preferences", "task.current").'),
  value: z.string()
    .describe('Memory value. Free-form text, will be embedded asynchronously.'),
  agent_id: z.string().optional()
    .describe('Agent identifier. Resolved from session if omitted.'),
  ttl: z.number().optional()
    .describe('Time-to-live in seconds. NULL for permanent. Memory auto-expires after this duration.'),
  extract_facts: z.boolean().default(false)
    .describe('If true, asynchronously extract atomic facts from value and store as Fact entities.')
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
1. Resolve `agent_id` from input or session context.
2. Look up the current max version for `(agent_id, key)`.
3. Insert a new Memory row with `version = max + 1` (or 1 if new).
4. If `ttl` is provided, compute `expires_at = NOW() + ttl * interval '1 second'`.
5. Enqueue async embedding generation for the value.
6. If `extract_facts` is true, enqueue fact extraction job.
7. Write an AuditEntry with `operation = 'write'`.

**Error handling:**
- Missing `agent_id` and no session context: return error
  `"agent_id is required when no session context is available"`.
- Value exceeds maximum size (configurable, default 100KB): return
  error `"value exceeds maximum size of {limit} bytes"`.

---

### read_memory

Read a memory entry by key. Supports fetching the latest version, a
specific version, or the full version history.

**Input:**
```typescript
{
  key: z.string()
    .describe('Memory key to read.'),
  agent_id: z.string().optional()
    .describe('Agent identifier. Resolved from session if omitted.'),
  version: z.union([z.number(), z.literal('all')]).optional()
    .describe('Specific version number, or "all" for full history. Omit for latest.')
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

**Response (version="all"):**
```json
[
  {
    "key": "user.preferences",
    "value": "Prefers concise answers, dark mode, metric units.",
    "version": 2,
    "created_at": "2026-03-29T10:00:00Z"
  },
  {
    "key": "user.preferences",
    "value": "Prefers concise answers.",
    "version": 1,
    "created_at": "2026-03-28T08:00:00Z"
  }
]
```

**Behavior:**
1. Resolve `agent_id` from input or session context.
2. Query Memory WHERE `agent_id`, `key`, `is_deleted = false`,
   and `(expires_at IS NULL OR expires_at > NOW())`.
3. If `version` is a number, filter to that specific version.
4. If `version` is `"all"`, return all non-deleted versions ordered
   by version descending.
5. If omitted, return the row with the highest version.
6. Write an AuditEntry with `operation = 'read'`.

**Error handling:**
- Key not found: return error `"memory not found for key: {key}"`.
- Specific version not found: return error
  `"version {version} not found for key: {key}"`.

---

### delete_memory

Soft-delete a memory entry. Sets `is_deleted = true` on the current
version. The entry is excluded from all subsequent reads and searches
but remains in the database for audit purposes.

**Input:**
```typescript
{
  key: z.string()
    .describe('Memory key to delete.'),
  agent_id: z.string().optional()
    .describe('Agent identifier. Resolved from session if omitted.')
}
```

**Response:**
```json
{
  "key": "user.preferences",
  "deleted": true
}
```

**Behavior:**
1. Resolve `agent_id` from input or session context.
2. Set `is_deleted = true` on all versions of `(agent_id, key)`.
3. Write an AuditEntry with `operation = 'delete'`.

**Error handling:**
- Key not found: return error `"memory not found for key: {key}"`.

---

### list_memories

List all active memory keys for an agent with pagination.

**Input:**
```typescript
{
  agent_id: z.string().optional()
    .describe('Agent identifier. Resolved from session if omitted.'),
  limit: z.number().default(50)
    .describe('Maximum number of entries to return.'),
  offset: z.number().default(0)
    .describe('Number of entries to skip for pagination.')
}
```

**Response:**
```json
{
  "memories": [
    {
      "key": "user.preferences",
      "version": 2,
      "created_at": "2026-03-29T10:00:00Z"
    },
    {
      "key": "task.current",
      "version": 1,
      "created_at": "2026-03-29T09:30:00Z"
    }
  ],
  "total": 42
}
```

**Behavior:**
1. Resolve `agent_id` from input or session context.
2. Query the latest version of each distinct key WHERE
   `agent_id` matches, `is_deleted = false`, and
   `(expires_at IS NULL OR expires_at > NOW())`.
3. Apply `limit` and `offset` for pagination.
4. Return the total count of active keys alongside the page.
5. Write an AuditEntry with `operation = 'read'`.

**Error handling:**
- No memories found: return `{ memories: [], total: 0 }` (not an
  error).

---

### search_memory

Hybrid search across an agent's memories using vector similarity and
keyword matching. Optionally includes shared pool memories.

**Input:**
```typescript
{
  query: z.string()
    .describe('Natural language search query.'),
  agent_id: z.string().optional()
    .describe('Agent identifier. Resolved from session if omitted.'),
  pool: z.string().optional()
    .describe('Include results from this shared pool in addition to private memories.'),
  limit: z.number().default(10)
    .describe('Maximum number of results to return.')
}
```

**Response:**
```json
{
  "results": [
    {
      "key": "user.preferences",
      "value": "Prefers concise answers, dark mode, metric units.",
      "score": 0.92,
      "agent_id": "agent-abc123"
    },
    {
      "key": "project.goals",
      "value": "Ship v2 API by end of Q1.",
      "score": 0.78,
      "agent_id": "agent-abc123"
    }
  ]
}
```

**Behavior:**
1. Resolve `agent_id` from input or session context.
2. Generate embedding for `query` via the configured embedding model.
3. Execute hybrid search:
   - Vector search via HNSW: `embedding <=> query_embedding`.
   - Keyword search via GIN: `search_tsv @@ plainto_tsquery(query)`.
   - Reciprocal Rank Fusion (k=60) to merge rankings.
4. Filter to `agent_id` private memories (WHERE `pool IS NULL`).
5. If `pool` is provided, also include memories WHERE
   `pool = {pool}`.
6. Exclude `is_deleted = true` and expired entries.
7. Also search Fact entities and map results back to parent Memory.
8. Apply `limit`.
9. Write an AuditEntry with `operation = 'search'` and metadata
   including query and results count.

**Error handling:**
- No results: return `{ results: [] }` (not an error).
- Embedding service unavailable: fall back to keyword-only search
  with a warning in the response.

---

## Shared Pool Tools

### shared_write

Write a memory entry to a shared pool, visible to all agents with
access to that pool.

**Input:**
```typescript
{
  pool: z.string()
    .describe('Shared pool name (e.g., "team-context", "project-alpha").'),
  key: z.string()
    .describe('Memory key within the pool.'),
  value: z.string()
    .describe('Memory value.'),
  agent_id: z.string().optional()
    .describe('Agent identifier (author). Resolved from session if omitted.')
}
```

**Response:**
```json
{
  "pool": "team-context",
  "key": "deployment.runbook",
  "version": 1,
  "agent_id": "agent-abc123"
}
```

**Behavior:**
1. Resolve `agent_id` from input or session context.
2. Insert a Memory row with `pool = {pool}`.
3. Version is monotonic per `(agent_id, key)` as with private writes.
4. Enqueue async embedding generation.
5. Write an AuditEntry with `operation = 'write'` and
   `pool = {pool}`.

**Error handling:**
- Pool name validation: must be lowercase alphanumeric with hyphens,
  3-64 characters. Return error `"invalid pool name: {pool}"` on
  violation.

---

### shared_read

Read entries from a shared pool. If `key` is provided, returns that
specific entry. Otherwise returns all entries in the pool.

**Input:**
```typescript
{
  pool: z.string()
    .describe('Shared pool name.'),
  key: z.string().optional()
    .describe('Specific key to read. If omitted, returns all pool entries.')
}
```

**Response:**
```json
{
  "pool": "team-context",
  "entries": [
    {
      "key": "deployment.runbook",
      "value": "1. Run preflight checks...",
      "agent_id": "agent-abc123",
      "created_at": "2026-03-29T10:00:00Z"
    }
  ]
}
```

**Behavior:**
1. Query Memory WHERE `pool = {pool}`, `is_deleted = false`, and
   not expired.
2. If `key` is provided, filter to that key (latest version).
3. If `key` is omitted, return the latest version of each distinct
   key in the pool.
4. Write an AuditEntry with `operation = 'read'` and
   `pool = {pool}`.

**Error handling:**
- Pool not found (no entries): return
  `{ pool: "{pool}", entries: [] }` (not an error).

---

## Snapshot Tools

### create_snapshot

Create a point-in-time snapshot of an agent's current memory state.
The snapshot stores references (memory ID + version), not copies.

**Input:**
```typescript
{
  agent_id: z.string().optional()
    .describe('Agent identifier. Resolved from session if omitted.')
}
```

**Response:**
```json
{
  "snapshot_id": "550e8400-e29b-41d4-a716-446655440000",
  "agent_id": "agent-abc123",
  "memory_count": 42,
  "created_at": "2026-03-29T10:00:00Z"
}
```

**Behavior:**
1. Resolve `agent_id` from input or session context.
2. Gather all active, non-deleted, non-expired memories for the
   agent: collect `{memory_id, version}` for the latest version of
   each key.
3. Insert a Snapshot row with `trigger = 'manual'` and the collected
   `memory_refs`.
4. Write an AuditEntry with `operation = 'snapshot'`.

**Error handling:**
- No active memories: return error
  `"no active memories to snapshot for agent: {agent_id}"`.

---

### restore_snapshot

Restore an agent's memory state from a snapshot. For each memory
reference in the snapshot, the referenced version becomes the new
current version (by inserting a new version row that copies the
snapshot's values).

**Input:**
```typescript
{
  snapshot_id: z.string()
    .describe('Snapshot ID to restore from.')
}
```

**Response:**
```json
{
  "snapshot_id": "550e8400-e29b-41d4-a716-446655440000",
  "memories_restored": 42
}
```

**Behavior:**
1. Load the Snapshot by ID.
2. For each `{memory_id, version}` in `memory_refs`:
   a. Read the referenced Memory row.
   b. Insert a new version of that key with the snapshot's value
      (effectively "restoring" it as the latest version).
3. Soft-delete any current keys that are not in the snapshot.
4. Write an AuditEntry with `operation = 'restore'` and metadata
   including `snapshot_id` and `memories_restored`.

**Error handling:**
- Snapshot not found: return error
  `"snapshot not found: {snapshot_id}"`.
- Referenced memory row missing (deleted by cleanup): skip it, log
  a warning, and include a `warnings` array in the response.

---

## Observability Tools

### agent_health

Return a health summary for an agent's memory subsystem.

**Input:**
```typescript
{
  agent_id: z.string().optional()
    .describe('Agent identifier. Resolved from session if omitted.')
}
```

**Response:**
```json
{
  "agent_id": "agent-abc123",
  "memory_count": 42,
  "last_active": "2026-03-29T10:00:00Z",
  "snapshot_count": 3,
  "status": "healthy"
}
```

**Behavior:**
1. Resolve `agent_id` from input or session context.
2. Count active, non-deleted, non-expired memories.
3. Find the most recent AuditEntry `created_at` for the agent.
4. Count snapshots for the agent.
5. Determine status:
   - `"healthy"`: memories exist and last activity within 24 hours.
   - `"idle"`: memories exist but no activity in 24+ hours.
   - `"empty"`: no memories found.

**Error handling:**
- Agent not found (no audit entries or memories): return response
  with `memory_count: 0`, `snapshot_count: 0`,
  `status: "empty"`, and `last_active: null`.

---

### agent_stats

Return usage statistics for an agent's memory operations.

**Input:**
```typescript
{
  agent_id: z.string().optional()
    .describe('Agent identifier. Resolved from session if omitted.')
}
```

**Response:**
```json
{
  "agent_id": "agent-abc123",
  "total_writes": 156,
  "total_searches": 89,
  "avg_search_latency_ms": 23.4,
  "top_keys": [
    { "key": "user.preferences", "access_count": 34 },
    { "key": "task.current", "access_count": 28 },
    { "key": "project.goals", "access_count": 19 }
  ]
}
```

**Behavior:**
1. Resolve `agent_id` from input or session context.
2. Query AuditEntry to compute:
   - `total_writes`: count WHERE `operation = 'write'`.
   - `total_searches`: count WHERE `operation = 'search'`.
   - `avg_search_latency_ms`: average from search audit metadata
     (latency is recorded in audit metadata by the search tool).
   - `top_keys`: top 10 keys by combined read + write access count.

**Error handling:**
- No audit data: return response with zeroed counters and empty
  `top_keys`.
