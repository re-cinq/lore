# Feature Specification: `lore_delete_memory` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `lore_delete_memory` MCP tool                         |
| Status  | In Progress                                      |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `lore_delete_memory`                                  |
| Module  | memory                                           |
| Scope   | shared                                           |

`lore_delete_memory` soft-deletes an agent memory by key, hiding it from reads, listings, and search while retaining its version history and audit trail so a stale or mistaken entry can be retired without losing provenance.

## Problem Statement

Agents accumulate memories that go stale — a convention is superseded, a
session summary is no longer relevant, a key was written by mistake. A hard
delete would erase the audit trail and version history that the memory module
deliberately preserves. We need a way to remove a memory from active reads and
search while keeping its history intact.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/memory-tools.ts#L112)).

- **name**: `lore_delete_memory`
- **description** (verbatim):

```text
Soft-deletes a memory by key (hides it from read/list/search; version history is retained) and returns {key, deleted: true}. Scope is agent_id, not repo. Use to retire a stale or mistaken memory. Instead: lore_cancel_local_task to stop a local background task; lore_cancel_task to cancel a pipeline task — those are unrelated.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `key` | string | yes | — | Exact memory key to soft-delete. |
| `agent_id` | string | no | — | — |

## Behavior

1. **DB path** — if `isMemoryDbAvailable()`: call `deleteMemory(key, agent_id)`
   ([handler](../../../libs/server-core/src/features/memory/memory.ts#L199)). Inside the handler:
   - `agent = resolveAgentId(agent_id)`.
   - `UPDATE memory.memories SET is_deleted = TRUE WHERE agent_id = $1 AND key =
     $2` — flips the flag for every version row of that agent+key. Note: scope
     is **agent_id**, not repo.
   - `auditLog(agent, 'delete', key)` → `memory.audit_log` (best-effort).
   - Return `{ key, deleted: true }`. `memory.memory_versions` is untouched.
   - Tool returns `JSON.stringify(result)`.
2. **Proxy path** — DB unavailable: `proxyMemory("delete", { key, agent_id:
   agent_id || resolveAgentId() })`. `ok` → `proxied.body`; `unreachable` →
   `unreachableError("lore_delete_memory", detail)`.
3. **File fallback** — proxy `not_configured`: `deleteMemoryFile(key,
   agent_id)`, return `JSON.stringify`.
4. Any thrown error → `"Error deleting memory: {message}"`.

Soft-deleted rows are excluded from `lore_read_memory`, `lore_list_memories`, and
`lore_search_memory` (all carry `is_deleted = FALSE` predicates).

## Output

A single MCP text content block. One of: `{"key":…,"deleted":true}` (DB or file
path), the proxied body, the `unreachableError` message, or
`"Error deleting memory: {message}"`. **Never throws.**

## Dependencies & side effects

- `isMemoryDbAvailable()`, `resolveAgentId()`.
- Handler `deleteMemory` ([memory.ts](../../../libs/server-core/src/features/memory/memory.ts#L199)).
- `proxyMemory` / `unreachableError` ([deps.ts](../../../apps/mcp-server/src/mcp/tools/deps.ts#L98)); `deleteMemoryFile` (offline).
- Tables: `memory.memories` (update `is_deleted`), `memory.audit_log` (insert). `memory.memory_versions` untouched.
- Env: `LORE_DB_HOST`, `LORE_API_URL` + `LORE_INGEST_TOKEN`.

## Acceptance Criteria

1. Deleting a key sets `is_deleted = TRUE` scoped to the agent and key and
   returns `{ key, deleted: true }`. ([validated by `soft-deletes by agent and key, returns deleted true`](libs/server-core/src/features/memory/memory.test.ts#L170))

2. A delete writes a `delete` audit-log entry naming the deleted key. ([validated by `writes a delete audit-log entry for the key`](libs/server-core/src/features/memory/memory.test.ts#L186))

3. The proxy / file-fallback framing has no unit seam. *(untested: the
   proxy/file branches need `LORE_API_URL` or offline mode; the soft-delete core
   is covered above.)*

## Out of Scope

- Hard deletion / purge of version history.
- Restoring a soft-deleted memory (handled via snapshots/restore).
- File-backed fallback delete (`deleteMemoryFile`).
- GKE-side `/api/memory` route handling.
