# Feature Specification: `lore_list_memories` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `lore_list_memories` MCP tool                         |
| Status  | In Progress                                      |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `lore_list_memories`                                  |
| Module  | memory                                           |
| Scope   | shared                                           |

`lore_list_memories` browses the stored memory keys for the current repo, newest-first and paginated, excluding expired and soft-deleted entries so agents can enumerate what exists without running a semantic search.

## Problem Statement

An agent (or a developer) needs to see what memories exist for the repo it is
working in without running a semantic search. Listing must be scoped — the
repo the caller is in is the natural unit — and paginated, since a busy repo
accumulates many memories. Expired and soft-deleted memories must not appear.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/memory-tools.ts#L136)).

- **name**: `lore_list_memories`
- **description** (verbatim):

```text
Lists memory keys for the current repo (newest-first, paginated), returning {memories: [{key, agent_id, repo, version, created_at, ttl_seconds, has_facts}], total}. Scope: detected repo wins; falls back to agent_id; then org-wide. Excludes expired and soft-deleted entries. Use to browse existing keys without ranking. Instead: lore_search_memory to find memories by meaning; lore_read_memory to fetch one specific value.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `agent_id` | string | no | — | Agent scope when no repo is detected (ignored when repo is detected). |
| `limit` | number | no | `50` | — |
| `offset` | number | no | `0` | Rows to skip for pagination (DB path only; not forwarded over proxy). |

## Behavior

1. Resolve `repo = detectCurrentRepo() || undefined`.
2. **DB path** — if `isMemoryDbAvailable()`: call `listMemories(agent_id, limit,
   offset, repo)` ([handler](../../../apps/mcp-server/src/features/memory/memory.ts#L198)). Inside the handler the **scope precedence** is:
   - `repo` present → `filter = "repo = $1 AND"`, params `[repo, limit,
     offset]`.
   - else `agentId` present → `filter = "agent_id = $1 AND"`, params
     `[resolveAgentId(agentId), limit, offset]`.
   - else → `filter = ""`, params `[limit, offset]` (org-wide).
   - **Rows** query: `SELECT key, agent_id, repo, version, created_at,
     ttl_seconds, EXISTS(SELECT 1 FROM memory.facts f WHERE f.memory_id = m.id)
     as has_facts FROM memory.memories m WHERE {filter} is_deleted = FALSE AND
     (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT
     $N OFFSET $N`.
   - **Count** query: same `{filter}` + active/non-expired predicates;
     `countParams` is `[repo]` / `[resolveAgentId(agentId)]` / `[]` to match the
     scope (no limit/offset).
   - `auditLog(agentId || 'org', 'list', null)` (best-effort).
   - Return `{ memories: rows, total }`. Tool emits `JSON.stringify(…, null, 2)`.
3. **Proxy path** — DB unavailable: `proxyMemory("list", { agent_id: agent_id ||
   undefined, limit, repo })`. `ok` → `proxied.body`; `unreachable` →
   `unreachableError("lore_list_memories", detail)`. (Note: `offset` is not forwarded
   over the proxy.)
4. **File fallback** — proxy `not_configured`: `listMemoriesFile(agent_id,
   limit, offset)`, return `JSON.stringify(…, null, 2)`.
5. Any thrown error → `"Error listing memories: {message}"`.

## Output

A single MCP text content block. One of: pretty-printed
`{ memories: [...], total: N }` where each row is `{ key, agent_id, repo,
version, created_at, ttl_seconds, has_facts }`; the proxied body; the
`unreachableError` message; or `"Error listing memories: {message}"`.
**Never throws.**

## Dependencies & side effects

- `detectCurrentRepo()`, `isMemoryDbAvailable()`, `resolveAgentId()`.
- Handler `listMemories` ([memory.ts](../../../apps/mcp-server/src/features/memory/memory.ts#L198)).
- `proxyMemory` / `unreachableError` ([deps.ts](../../../apps/mcp-server/src/mcp/tools/deps.ts#L98)); `listMemoriesFile` (offline).
- Tables: `memory.memories` (read), `memory.facts` (EXISTS subquery), `memory.audit_log` (insert).
- Env: `LORE_DB_HOST`, `LORE_API_URL` + `LORE_INGEST_TOKEN`.

## Acceptance Criteria

1. A repo-scoped list passes the repo as the first param and returns
   `{ memories, total }`. ([validated by `scopes by repo and returns rows plus total`](libs/server-core/src/features/memory/memory.test.ts#L200))

2. When both repo and agent are supplied, the repo filter wins. ([validated by `repo filter wins over agent when both supplied`](libs/server-core/src/features/memory/memory.test.ts#L224))

3. With no repo, the list scopes by agent and the count query carries only the
   agent param. ([validated by `scopes by agent when no repo, count params hold only the agent`](libs/server-core/src/features/memory/memory.test.ts#L241))

4. With neither repo nor agent, the list is org-wide and the count query takes
   no scope params. ([validated by `org-wide list when no repo and no agent uses empty filter`](libs/server-core/src/features/memory/memory.test.ts#L258))

## Out of Scope

- Semantic ranking of results (that is `lore_search_memory`).
- File-backed fallback list (`listMemoriesFile`).
- Cross-repo aggregation.
- GKE-side `/api/memory` route handling.
