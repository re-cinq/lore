# Feature Specification: `list_memories` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `list_memories` MCP tool                         |
| Status  | **Draft**                                        |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `list_memories`                                  |
| Module  | memory                                           |
| Scope   | shared                                           |

## Problem Statement

An agent (or a developer) needs to see what memories exist for the repo it is
working in without running a semantic search. Listing must be scoped — the
repo the caller is in is the natural unit — and paginated, since a busy repo
accumulates many memories. Expired and soft-deleted memories must not appear.

## Solution

`list_memories` returns the active, non-expired memories for the current repo,
ordered newest-first, with pagination. The handler auto-detects the repo from
the git remote; scope falls back to `agent_id`, then to an org-wide list when
neither is supplied. Each row carries a `has_facts` flag. The result includes a
`total` count for the same scope.

- Registration: [`memory-tools.ts`](../../../mcp-server/src/mcp/tools/memory-tools.ts#L136) (IMPLEMENTED_BY)
- Handler: [`memory.ts` `listMemories`](../../../mcp-server/src/features/memory/memory.ts#L198) (IMPLEMENTED_BY)

## Acceptance Criteria

1. A repo-scoped list passes the repo as the first param and returns
   `{ memories, total }`. ([validated by `scopes by repo and returns rows plus total`](../../../mcp-server/src/features/memory/memory.test.ts#L164))
2. When both repo and agent are supplied, the repo filter wins. ([validated by `repo filter wins over agent when both supplied`](../../../mcp-server/src/features/memory/memory.test.ts#L181))
3. With no repo, the list scopes by agent and the count query carries only the
   agent param. ([validated by `scopes by agent when no repo, count params hold only the agent`](../../../mcp-server/src/features/memory/memory.test.ts#L192))
4. With neither repo nor agent, the list is org-wide and the count query takes
   no scope params. ([validated by `org-wide list when no repo and no agent uses empty filter`](../../../mcp-server/src/features/memory/memory.test.ts#L203))

## Out of Scope

- Semantic ranking of results (that is `search_memory`).
- File-backed fallback list (`listMemoriesFile`).
- Cross-repo aggregation.
