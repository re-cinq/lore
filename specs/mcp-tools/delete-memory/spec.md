# Feature Specification: `delete_memory` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `delete_memory` MCP tool                         |
| Status  | **Draft**                                        |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `delete_memory`                                  |
| Module  | memory                                           |
| Scope   | shared                                           |

## Problem Statement

Agents accumulate memories that go stale — a convention is superseded, a
session summary is no longer relevant, a key was written by mistake. A hard
delete would erase the audit trail and version history that the memory module
deliberately preserves. We need a way to remove a memory from active reads and
search while keeping its history intact.

## Solution

`delete_memory` soft-deletes a memory by key: it flips `is_deleted = TRUE` on
the `memory.memories` row(s) for the agent and writes a `delete` entry to
`memory.audit_log`. The version rows in `memory.memory_versions` are untouched,
so history remains queryable. Soft-deleted rows are excluded from
`read_memory`, `list_memories`, and `search_memory`.

- Registration: [`memory-tools.ts`](../../../mcp-server/src/mcp/tools/memory-tools.ts#L112) (IMPLEMENTED_BY)
- Handler: [`memory.ts` `deleteMemory`](../../../mcp-server/src/features/memory/memory.ts#L183) (IMPLEMENTED_BY)

## Acceptance Criteria

1. Deleting a key sets `is_deleted = TRUE` scoped to the agent and key and
   returns `{ key, deleted: true }`. ([validated by `soft-deletes by agent and key, returns deleted true`](../../../mcp-server/src/features/memory/memory.test.ts#L139))
2. A delete writes a `delete` audit-log entry naming the deleted key. ([validated by `writes a delete audit-log entry for the key`](../../../mcp-server/src/features/memory/memory.test.ts#L152))

## Out of Scope

- Hard deletion / purge of version history.
- Restoring a soft-deleted memory (handled via snapshots/restore).
- File-backed fallback delete (`deleteMemoryFile`).
