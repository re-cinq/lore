# MCP Tool Contracts: Lore Platform

All tools are registered via `@modelcontextprotocol/sdk` using
`server.tool()` with Zod input schemas. Responses follow the MCP
content format: `{ content: [{ type: 'text', text: string }] }`.

## Phase 0 Tools (File-Backed)

### get_context

Returns the merged CLAUDE.md content for the organization and
optionally a specific team.

**Input:**
```typescript
{
  team: z.string().optional()
    .describe('Team name (e.g., "payments"). If omitted, returns org-level context only.')
}
```

**Output:** Concatenated markdown content.
- Always includes: root `CLAUDE.md`.
- If `team` provided: appends `teams/<team>/CLAUDE.md`.
- If team file not found: returns org-level only with a note.

**Phase 0:** Reads files from `$CONTEXT_PATH`.
**Phase 1:** Queries `org_shared` schema + team schema.

**Error handling:** If `$CONTEXT_PATH` not set or directory missing,
return error text with fix instruction (`run install.sh`).

---

### get_adrs

Returns ADRs filtered by domain and/or status.

**Input:**
```typescript
{
  domain: z.string().optional()
    .describe('Filter by domain (e.g., "payments", "billing"). Matches ADR frontmatter domains array.'),
  status: z.enum(['proposed', 'accepted', 'deprecated', 'superseded'])
    .default('accepted')
    .describe('ADR status filter. Defaults to accepted.')
}
```

**Output:** Array of ADR documents as markdown, each with frontmatter
preserved. Sorted by `adr_number` descending (newest first).

**Phase 0:** Reads `adrs/*.md`, parses YAML frontmatter, filters.
**Phase 1:** Queries `org_shared.chunks` WHERE `content_type = 'adr'`
and metadata filters.

**Error handling:** Empty domain match returns empty array with a
note listing available domains.

---

### search_context

Searches across all context content for a query string.

**Input:**
```typescript
{
  query: z.string()
    .describe('Search query in natural language.'),
  team: z.string().optional()
    .describe('Scope search to a specific team. If omitted, searches org-wide.'),
  limit: z.number().default(8)
    .describe('Maximum results to return.')
}
```

**Output:** Array of result objects, each containing:
- `content`: matched text excerpt.
- `source`: file path or PR reference.
- `content_type`: code, pull_request, adr, doc, spec, runbook.
- `score`: relevance score (Phase 1 only — RRF score).

**Phase 0:** Naive text match (case-insensitive substring search
across all `.md` files in `$CONTEXT_PATH`). Returns matching
paragraphs with file path as source.

**Phase 1:** Hybrid search:
1. Vector search via HNSW (`embedding <=> embedding('text-embedding-005', query)`).
2. Keyword search via BM25 (`search_tsv @@ plainto_tsquery(query)`).
3. Reciprocal Rank Fusion (k=60) to merge rankings.
4. If `team` provided: scope to team schema + `org_shared`.
5. If no `team`: search `org_shared` only.

**Degraded mode:** If PostgreSQL unreachable, fall back to Phase 0
text match on local files. Display one-time warning.

---

## Phase 1 Tools (PostgreSQL + Klaus)

### get_file_pr_history

Returns the PR history for a specific file path.

**Input:**
```typescript
{
  file_path: z.string()
    .describe('Relative file path in the source repo (e.g., "src/charges/builder.ts").')
}
```

**Output:** Array of PR summaries that modified this file, sorted
by merge date descending. Each includes:
- `pr_number`: PR identifier.
- `merged_at`: merge timestamp.
- `description`: PR description excerpt.
- `alternatives_rejected`: from PR template (if present).
- `adr_refs`: linked ADRs.

**Implementation:** Query `chunks` WHERE `content_type = 'pull_request'`
AND `file_path` in `metadata.files_changed`.

---

### delegate_task

Submit work to a Klaus cluster agent via the Lore MCP server.

**Input:**
```typescript
{
  task: z.string()
    .describe('Natural language description of the work to perform.'),
  context: z.object({
    beads_task_id: z.string().optional()
      .describe('Beads task ID — packages task description into context bundle.'),
    spec_file: z.boolean().optional()
      .describe('If true, include .specify/spec.md and constitution.md in context.'),
    branch: z.string().optional()
      .describe('Branch for the Klaus agent to clone and work on.'),
    seed_query: z.string().optional()
      .describe('Pre-fetch PostgreSQL context chunks matching this query for the agent.')
  }).optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal')
}
```

**Output:**
```json
{
  "task_id": "kl-9f3a",
  "status": "submitted",
  "message": "Task submitted. Check status: task_status(\"kl-9f3a\")"
}
```

**Behavior:**
1. `buildContextBundle()` packages all requested context.
2. Submits to Klaus HTTP endpoint (`$LORE_KLAUS_ENDPOINT/mcp`).
3. Returns immediately (non-blocking).
4. If Beads task ID provided, Klaus agent claims it atomically.

**Error handling:**
- Klaus unreachable: return error with "cluster unavailable" message.
- Invalid Beads task ID: return error, do not submit to Klaus.

---

### task_status

Poll the status of a running cluster task.

**Input:**
```typescript
{
  task_id: z.string()
    .describe('Task ID returned by delegate_task.')
}
```

**Output:**
```json
{
  "task_id": "kl-9f3a",
  "status": "running",
  "submitted_at": "2026-03-25T10:30:00Z",
  "elapsed": "4m 32s"
}
```

On failure:
```json
{
  "task_id": "kl-9f3a",
  "status": "failed",
  "failure_reason": "OOM: exceeded 4GB memory limit",
  "beads_claim_released": true
}
```

---

### task_result

Retrieve the full result of a completed cluster task.

**Input:**
```typescript
{
  task_id: z.string()
    .describe('Task ID returned by delegate_task.')
}
```

**Output:** Full text output from the Klaus agent. If task is not
yet completed, returns current status instead.

---

### list_cluster_tasks

List all cluster tasks visible to this team.

**Input:** None.

**Output:** Array of task summaries:
```json
[
  {
    "task_id": "kl-9f3a",
    "status": "running",
    "task_summary": "Write integration tests for IdempotencyKey.wrap()",
    "submitted_at": "2026-03-25T10:30:00Z",
    "priority": "normal"
  }
]
```

## Phase 3 Tools

### graph_search

Traverse the knowledge graph for multi-hop reasoning queries.

**Input:**
```typescript
{
  query: z.string()
    .describe('Question requiring multi-hop reasoning across content types.'),
  depth: z.number().default(2)
    .describe('Maximum traversal depth (1-3).')
}
```

**Output:** Chain of related entities with relationship labels:
```
code:ChargeBuilder → implemented_by:PR#1201 → references:ADR-042
  → supersedes:ADR-019 → discussed_in:slack#payments-arch
```

---

### get_domain_summary

Returns a community summary for a domain from the GraphRAG output.

**Input:**
```typescript
{
  domain: z.string()
    .describe('Domain name (e.g., "payments", "auth").')
}
```

**Output:** Prose summary of the domain's key entities, patterns,
decisions, and relationships. Generated by the GraphRAG community
detection algorithm.
