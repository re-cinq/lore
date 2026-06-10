# Feature Specification: `read_memory` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `read_memory` MCP tool                           |
| Status  | **Draft**                                        |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `read_memory`                                    |
| Module  | memory                                           |
| Scope   | shared                                           |

## Problem Statement

When an agent knows the exact key of a memory it wants — a named convention, a
dated session summary — semantic search is the wrong tool. It needs a direct,
exact-key read, including the ability to inspect the full version history or a
specific past version of a memory that has since changed.

## Solution

`read_memory` returns a memory by key for the resolved agent. With no `version`
it returns the latest non-deleted, non-expired row. `version: "all"` returns
every version newest-first from `memory.memory_versions`; a numeric `version`
returns that single historical version. A missing key returns null (the tool
surfaces a "not found" message). Every read appends to `memory.audit_log`.

- Registration: [`memory-tools.ts`](../../../mcp-server/src/mcp/tools/memory-tools.ts#L84) (IMPLEMENTED_BY)
- Handler: [`memory.ts` `readMemory`](../../../mcp-server/src/features/memory/memory.ts#L131) (IMPLEMENTED_BY)

## Acceptance Criteria

1. A plain read returns the latest non-deleted version for the key. ([validated by `returns the latest non-deleted version for a key`](../../../mcp-server/src/features/memory/memory.test.ts#L89))
2. `version: "all"` returns every version newest-first. ([validated by `returns all versions newest-first when version is "all"`](../../../mcp-server/src/features/memory/memory.test.ts#L108))
3. A missing key returns null. ([validated by `returns null when the key does not exist`](../../../mcp-server/src/features/memory/memory.test.ts#L128))

## Out of Scope

- Retrieval strengthening side-effects.
- File-backed fallback read (`readMemoryFile`).
