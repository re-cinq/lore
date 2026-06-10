# Feature Specification: `write_memory` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `write_memory` MCP tool                          |
| Status  | **Draft**                                        |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `write_memory`                                   |
| Module  | memory                                           |
| Scope   | shared                                           |

## Problem Statement

Agents and developers need to persist decisions, conventions, corrections, and
session summaries so the next session — possibly run by a different developer
in the same repo — starts with that knowledge. Writes must be versioned (no
silent overwrite of prior knowledge), scoped to the repo, and optionally
expiring, with an audit trail.

## Solution

`write_memory` stores a key→value memory scoped to the current repo (shared
across every developer in that repo). A first write inserts version 1; a write
to an existing key increments the version and updates the row in place while
preserving the prior value in `memory.memory_versions`. An optional `ttl` sets
`expires_at`; an optional embedding backs semantic search. Every write appends
to `memory.audit_log`.

- Registration: [`memory-tools.ts`](../../../mcp-server/src/mcp/tools/memory-tools.ts#L40) (IMPLEMENTED_BY)
- Handler: [`memory.ts` `writeMemory`](../../../mcp-server/src/features/memory/memory.ts#L49) (IMPLEMENTED_BY)

## Acceptance Criteria

1. A first write of a key inserts version 1 and returns the write result with
   key, version, agent, and timestamp. ([validated by `inserts version 1 for a new key and returns the write result`](../../../mcp-server/src/features/memory/memory.test.ts#L53))
2. A write to an existing key increments the version and updates the row in
   place. ([validated by `increments version when the key already exists`](../../../mcp-server/src/features/memory/memory.test.ts#L73))

## Out of Scope

- Async fact extraction triggered by `extract_facts` (fire-and-forget side
  effect in the tool handler).
- Embedding generation (owned by the embedding service).
- File-backed fallback write (`writeMemoryFile`).
