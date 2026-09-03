# Feature Specification: lore_search_context MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_search_context MCP Tool        |
| Status  | In Progress                    |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_search_context`               |
| Module  | Context (`context-tools.ts`)   |
| Scope   | shared                         |

`lore_search_context` searches a repo's ingested document corpus for matching passages via hybrid vector plus BM25 retrieval, degrading to a local file-system text scan when no database is available.

## Problem Statement

A developer or agent needs to find relevant passages across a repo's ingested
context (CLAUDE.md, ADRs, team docs) without knowing which file holds them.
`lore_search_context` is the keyword/passage search over that corpus — backed by the
hybrid vector+BM25 store when a database is available, and degrading to a
deterministic file-system text scan when it is not, so it works locally before
any ingest has run.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/context-tools.ts#L23)).

- **name**: `lore_search_context`
- **description** (verbatim):

```text
Searches the repo/org ingested-document corpus (CLAUDE.md, ADRs, team docs, specs) and returns raw matching passages as source-scored snippets. Uses hybrid vector+BM25 retrieval when a DB is available; falls back to case-insensitive substring scan of local .md files otherwise.
Use this when you want chunk-level evidence or the exact wording of a convention/ADR. For a ONE token-budgeted bundle combining all sources (conventions, ADRs, memories, facts, graph) call lore_assemble_context — that is the mandatory first call. For past learnings, decisions, and extracted facts from prior sessions call lore_search_memory. For entity relationships call lore_query_graph.
```

### Input schema (Zod)

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `query` | string | yes | — | Natural-language search query. |
| `team` | string | no | — | Team schema name to scope the search (e.g. 'platform'). Omit to search org_shared; unknown teams fall back to org_shared on the DB path or return an error on the file path. |
| `limit` | number | no | `8` | Maximum passages to return. |

## Behavior

1. **Repo auto-detect** — when no `team` is given, call `detectCurrentRepo()` and
   log `"[lore] lore_search_context: auto-detected repo {repo}"` to stderr (advisory).
2. **DB path** — if `isDbAvailable()`:
   1. `schema = team || "org_shared"`; `results = hybridSearch(query, schema, limit)`
      ([hybridSearch](../../../libs/server-core/src/platform/db.ts#L109) — HNSW vector +
      BM25, fused by RRF). `hybridSearch` resolves the schema dynamically via the
      shared `chunkSchemaOrOrgShared`: a provisioned team schema is searched
      directly; an unknown, unprovisioned, or injection-shaped name falls back to
      `org_shared` (no static schema allow-list).
   2. If `results` is empty **and** `team` is set and `team !== "org_shared"`,
      retry `hybridSearch(query, "org_shared", limit)` (fall back to org corpus).
   3. `traceRetrieval({ query, namespace: schema, topScore: results[0]?.rrf_score || 0, resultCount })`.
   4. Empty ⇒ return `No results for "{query}".`
   5. Else join each result as `**Score:** {rrf_score.toFixed(3)}\n\n{content}`
      with the separator `\n\n---\n\n`.
3. **File fallback** (no DB):
   1. `searchRoot = team ? {CONTEXT_PATH}/teams/{team} : {CONTEXT_PATH}`
      (`CONTEXT_PATH` env, default `process.cwd()`).
   2. If `searchRoot` does not exist ⇒ return `Error: search path not found at {searchRoot}.`
   3. Glob `**/*.md` (nodir) under the root; for each file split on `/\n{2,}/`
      into paragraphs; push `{ source: relativePath, paragraph: trimmed }` for any
      paragraph containing the lowercased query; stop at `limit`.
   4. `traceRetrieval({ query, namespace: team || "org", topScore: results.length ? 1.0 : 0.0, resultCount })`.
   5. Empty ⇒ return `No results found for "{query}".` *(note: distinct wording from
      the DB path's message — preserve both verbatim).*
   6. Else join each as `**Source:** {source}\n\n{paragraph}` with `\n\n---\n\n`.

## Output

A single MCP text content block: either the formatted result list (DB form with
`**Score:**`, or file form with `**Source:**`), or one of the two no-results
strings, or the path-not-found error. Never throws.

## Dependencies & side effects

- `isDbAvailable()`, `hybridSearch()` (Postgres + pgvector), `detectCurrentRepo()`,
  `traceRetrieval()` (OTEL span). Filesystem glob/read on the fallback path.
- Env: `CONTEXT_PATH`.

## Acceptance Criteria

A matching paragraph is returned with its source path. ([validated by `returns the matching paragraph with its source path`](apps/mcp-server/src/mcp/tools/context-tools.test.ts#L56))

Matching is case-insensitive. ([validated by `matches case-insensitively`](apps/mcp-server/src/mcp/tools/context-tools.test.ts#L67))

Paragraphs that do not contain the query are excluded. ([validated by `excludes paragraphs that do not contain the query`](apps/mcp-server/src/mcp/tools/context-tools.test.ts#L76))

When nothing matches, a no-results message is returned. ([validated by `returns a no-results message when nothing matches`](apps/mcp-server/src/mcp/tools/context-tools.test.ts#L84))

The number of returned paragraphs is capped at `limit`. ([validated by `caps the number of returned paragraphs at the limit`](apps/mcp-server/src/mcp/tools/context-tools.test.ts#L95))

A `team` scopes the search to that team subtree. ([validated by `scopes the search to a team subtree when team is given`](apps/mcp-server/src/mcp/tools/context-tools.test.ts#L102))

An unknown team yields a path-not-found error. ([validated by `returns a path-not-found error for an unknown team`](apps/mcp-server/src/mcp/tools/context-tools.test.ts#L112))

`hybridSearch` searches a provisioned team schema directly. ([validated by `searches a provisioned team schema directly`](libs/server-core/src/platform/db.test.ts#L29))

`hybridSearch` falls back to `org_shared` for an unprovisioned schema. ([validated by `falls back to org_shared for an unprovisioned schema`](libs/server-core/src/platform/db.test.ts#L46))

`hybridSearch` falls back to `org_shared` for an injection-shaped schema name without an existence check. ([validated by `falls back to org_shared for an injection-shaped schema without an existence check`](libs/server-core/src/platform/db.test.ts#L59))

The DB branch's ranking quality is exercised only against live Postgres + Vertex
embeddings. *(untested beyond schema resolution: the RRF result-formatting is
inline in the handler with no extractable seam; the file-fallback branch above
is fully covered.)*

## Out of Scope

- Hybrid vector+BM25 ranking internals (RRF) — owned by the retrieval layer.
- Embedding generation.
- Ingesting `.md` files into the store (see the ingest tools).
