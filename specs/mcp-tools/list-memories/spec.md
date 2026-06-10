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

## Interface

Registered via `server.tool` ([registration](../../../mcp-server/src/mcp/tools/memory-tools.ts#L136)).

- **name**: `list_memories`
- **description** (verbatim): *"List memories for the current repo. Auto-detects
  which repo you're in."*

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `agent_id` | string | no | — | Scope to an agent when no repo is detected. |
| `limit` | number | no | `50` | Max results. |
| `offset` | number | no | `0` | Pagination offset. |

## Behavior

1. Resolve `repo = detectCurrentRepo() || undefined`.
2. **DB path** — if `isMemoryDbAvailable()`: call `listMemories(agent_id, limit,
   offset, repo)` ([handler](../../../mcp-server/src/features/memory/memory.ts#L198)). Inside the handler the **scope precedence** is:
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
   `unreachableError("list_memories", detail)`. (Note: `offset` is not forwarded
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
- Handler `listMemories` ([memory.ts](../../../mcp-server/src/features/memory/memory.ts#L198)).
- `proxyMemory` / `unreachableError` ([deps.ts](../../../mcp-server/src/mcp/tools/deps.ts#L98)); `listMemoriesFile` (offline).
- Tables: `memory.memories` (read), `memory.facts` (EXISTS subquery), `memory.audit_log` (insert).
- Env: `LORE_DB_HOST`, `LORE_API_URL` + `LORE_INGEST_TOKEN`.

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
- GKE-side `/api/memory` route handling.
