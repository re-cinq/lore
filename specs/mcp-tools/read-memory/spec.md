# Feature Specification: `lore_read_memory` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `lore_read_memory` MCP tool                           |
| Status  | **Draft**                                        |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `lore_read_memory`                                    |
| Module  | memory                                           |
| Scope   | shared                                           |

## Problem Statement

When an agent knows the exact key of a memory it wants — a named convention, a
dated session summary — semantic search is the wrong tool. It needs a direct,
exact-key read, including the ability to inspect the full version history or a
specific past version of a memory that has since changed.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/memory-tools.ts#L84)).

- **name**: `lore_read_memory`
- **description** (verbatim):

```text
Fetches one memory by its exact key and returns the stored row as JSON (latest version by default, or full history/specific version on request). Use only when you already know the precise key. Instead: lore_search_memory when searching by meaning; lore_list_memories to enumerate keys.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `key` | string | yes | — | Exact memory key; no wildcards or fuzzy matching. |
| `agent_id` | string | no | — | Override the resolved agent ID. |
| `version` | string | no | — | "all" for full history newest-first, or a numeric string for one specific version. Omit for the latest non-deleted version. |

## Behavior

1. Normalize `version`: `"all"` stays `"all"`; a non-empty string → `Number(version)`;
   omitted → `undefined`.
2. **DB path** — if `isMemoryDbAvailable()`: call
   `readMemory(key, agent_id, ver)` ([handler](../../../apps/mcp-server/src/features/memory/memory.ts#L131)). Inside the handler
   (`agent = resolveAgentId(agent_id)`):
   - **`version === 'all'`** → `SELECT mv.version, mv.value, mv.created_at FROM
     memory.memory_versions mv JOIN memory.memories m ON m.id = mv.memory_id
     WHERE m.agent_id = $1 AND m.key = $2 ORDER BY mv.version DESC`. Returns the
     full rows array.
   - **numeric `version`** (or numeric string) → same join `WHERE … AND
     mv.version = $3`. Returns `rows[0] || null`.
   - **latest** → `SELECT key, value, version, created_at FROM memory.memories
     WHERE agent_id = $1 AND key = $2 AND is_deleted = FALSE AND (expires_at IS
     NULL OR expires_at > now()) ORDER BY version DESC LIMIT 1`. Returns
     `rows[0] || null`.
   - Every branch calls `auditLog(agent, 'read', key)` (best-effort).
   - **Null guard**: handler returns falsy → tool returns `Memory "{key}" not
     found.`; otherwise `JSON.stringify(result, null, 2)`.
3. **Proxy path** — DB unavailable: `proxyMemory("read", { key, agent_id:
   agent_id || resolveAgentId(), version })`. `ok` → `proxied.body`;
   `unreachable` → `unreachableError("lore_read_memory", detail)`.
4. **File fallback** — proxy `not_configured`: `readMemoryFile(key, agent_id,
   ver)`; null → `Memory "{key}" not found.`, else `JSON.stringify(…, null, 2)`.
5. Any thrown error → `"Error reading memory: {message}"`.

## Output

A single MCP text content block. One of: pretty-printed JSON (latest row, the
full-history array, or a single version row), `Memory "{key}" not found.`, the
proxied body, the `unreachableError` message, or
`"Error reading memory: {message}"`. **Never throws.**

## Dependencies & side effects

- `isMemoryDbAvailable()`, `resolveAgentId()`.
- Handler `readMemory` ([memory.ts](../../../apps/mcp-server/src/features/memory/memory.ts#L131)).
- `proxyMemory` / `unreachableError` ([deps.ts](../../../apps/mcp-server/src/mcp/tools/deps.ts#L98)); `readMemoryFile` (offline).
- Tables: `memory.memories` (read), `memory.memory_versions` (read), `memory.audit_log` (insert).
- Env: `LORE_DB_HOST`, `LORE_API_URL` + `LORE_INGEST_TOKEN`.

## Acceptance Criteria

1. A plain read returns the latest non-deleted version for the key. ([validated by `returns the latest non-deleted version for a key`](libs/server-core/src/features/memory/memory.test.ts#L110))

2. `version: "all"` returns every version newest-first. ([validated by `returns all versions newest-first when version is "all"`](libs/server-core/src/features/memory/memory.test.ts#L137))

3. A missing key returns null. ([validated by `returns null when the key does not exist`](libs/server-core/src/features/memory/memory.test.ts#L158))

4. The tool-level "not found" / proxy / file-fallback framing has no unit seam.
   *(untested: the handler null→message mapping and the proxy/file branches need
   a live DB or `LORE_API_URL`; the handler read paths are covered above.)*

## Out of Scope

- Retrieval strengthening side-effects (`lore_search_memory` only).
- File-backed fallback read (`readMemoryFile`).
- GKE-side `/api/memory` route handling.
