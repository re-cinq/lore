# Feature Specification: `lore_write_memory` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `lore_write_memory` MCP tool                          |
| Status  | In Progress                                      |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `lore_write_memory`                                   |
| Module  | memory                                           |
| Scope   | shared                                           |

`lore_write_memory` persists one curated key/value memory, versioned and repo-scoped with optional expiry, pushing to the org-wide backend when the local server has no database.

## Problem Statement

Agents and developers need to persist decisions, conventions, corrections, and
session summaries so the next session — possibly run by a different developer
in the same repo — starts with that knowledge. Writes must be versioned (no
silent overwrite of prior knowledge), scoped to the repo, optionally expiring,
and recorded in an audit trail. When the local MCP server has no DB it must
push to the org-wide GKE backend rather than silently diverging to a local
file.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/memory-tools.ts#L40)).

- **name**: `lore_write_memory`
- **description** (verbatim):

```text
Stores one curated key/value memory (versioned, repo-scoped when a repo is detected, agent-scoped otherwise) and returns {key, version, agent_id, created_at}. Use when you have a decision, convention, correction, or session summary you want to retrieve later by a key you choose. Instead: lore_write_episode for raw uncurated text with no chosen key.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `key` | string | yes | — | Caller-chosen retrieval key; slash-namespaced by convention, e.g. 'session-summary/2026-03-30'. |
| `value` | string | yes | — | Memory value (text). Embedded for semantic search. |
| `agent_id` | string | no | — | Override the resolved agent ID. |
| `ttl` | number | no | — | Time-to-live in seconds. Omit for no expiry. |
| `extract_facts` | boolean | no | — | When true, triggers async fact extraction from value (fire-and-forget). |

## Behavior

1. Resolve `repo = detectCurrentRepo() || undefined`.
2. Compute `embedding = await getQueryEmbedding(value)` (Vertex; may be null).
3. **DB path** — if `isMemoryDbAvailable()`:
   1. Call `writeMemory(key, value, agent_id, ttl, embedding || undefined, repo)`
      ([handler](../../../libs/server-core/src/features/memory/memory.ts#L53)). Inside the handler:
      - Resolve `agent = resolveAgentId(agent_id)`. Set `expiresAt` SQL to
        `now() + interval '{ttl} seconds'` when `ttl` is set, else null.
      - **Lookup scope**: when `repo` is present, match on `repo`; otherwise on
        `agent_id`. `SELECT id, version … WHERE {field} = $1 AND key = $2 AND
        is_deleted = FALSE ORDER BY version DESC LIMIT 1`.
      - **Existing key** → `version = existing.version + 1`; `UPDATE
        memory.memories SET value, version, embedding, ttl_seconds, expires_at,
        created_at = now() WHERE id = …`.
      - **New key** → `version = 1`; `INSERT INTO memory.memories (agent_id,
        key, value, embedding, version, ttl_seconds, expires_at, repo)`
        returning `id, created_at`.
      - Always `INSERT INTO memory.memory_versions (memory_id, version, value,
        embedding)` to preserve history.
      - `auditLog(agent, 'write', key)` → `memory.audit_log` (best-effort).
      - Re-`SELECT created_at` and return
        `{ key, version, agent_id, created_at }`.
   2. **If `extract_facts`** — dynamically `import("memory.js")`, grab
      `getMemoryPool()`, `SELECT id FROM memory.memories WHERE key = $1 AND
      (repo = $2 OR agent_id = $3) ORDER BY version DESC LIMIT 1`, and on a hit
      fire `extractFacts(id, value, pool)` ([facts](../../../libs/server-core/src/features/memory/facts.ts#L176))
      fire-and-forget (`.catch(() => {})`). Does **not** block the response.
   3. Return `JSON.stringify(result)` as text.
4. **Proxy path** — DB unavailable: `proxyMemory("write", { key, value,
   agent_id: agent_id || resolveAgentId(), ttl, repo })`.
   - `ok` → return `proxied.body`.
   - `reason === "unreachable"` → `unreachableError("lore_write_memory", detail)`
     (the proxy was configured but failed all 4 attempts; refuses file
     fallback).
5. **File fallback** — only when the proxy is `not_configured` (true offline):
   `writeMemoryFile(key, value, agent_id, ttl)`, return `JSON.stringify`.
6. Any thrown error → `"Error writing memory: {message}"`.

## Output

A single MCP text content block. One of: the JSON write result
`{ key, version, agent_id, created_at }` (DB or file path), the proxied body,
the `unreachableError` message, or `"Error writing memory: {message}"`.
**Never throws.**

## Dependencies & side effects

- `detectCurrentRepo()`, `getQueryEmbedding()` (Vertex), `isMemoryDbAvailable()`.
- Handler `writeMemory` ([memory.ts](../../../libs/server-core/src/features/memory/memory.ts#L53)); `extractFacts` (async).
- `proxyMemory` / `unreachableError` ([deps.ts](../../../apps/mcp-server/src/mcp/tools/deps.ts#L15)); `writeMemoryFile` (offline).
- Tables: `memory.memories` (insert/update), `memory.memory_versions` (insert), `memory.audit_log` (insert), `memory.facts` (async via `extract_facts`).
- Env: `LORE_DB_HOST` (DB availability), `LORE_API_URL` + `LORE_INGEST_TOKEN` (proxy).

## Acceptance Criteria

1. A first write of a key inserts version 1 and returns the write result with
   key, version, agent, and timestamp. ([validated by `inserts version 1 for a new key and returns the write result`](libs/server-core/src/features/memory/memory.test.ts#L50))

2. A write to an existing key increments the version and updates the row in
   place. ([validated by `increments version when the key already exists`](libs/server-core/src/features/memory/memory.test.ts#L78))

3. The handler orchestration (repo detect, embedding, proxy/file fallback,
   `extract_facts` trigger) has no unit seam. *(untested: the DB branch needs a
   live `memory.memories`; the proxy branch needs `LORE_API_URL`; the
   `extract_facts` trigger is a fire-and-forget dynamic import — the versioning
   core is covered above.)*

## Out of Scope

- Async fact extraction triggered by `extract_facts` (fire-and-forget side
  effect; owned by the `facts` module / `lore_write_episode` spec).
- Embedding generation (owned by the embedding service).
- File-backed fallback write (`writeMemoryFile`).
- GKE-side `/api/memory` route handling (server-side).
