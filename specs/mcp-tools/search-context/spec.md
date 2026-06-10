# Feature Specification: search_context MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | search_context MCP Tool        |
| Status  | **Draft**                      |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `search_context`               |
| Module  | Context (`context-tools.ts`)   |
| Scope   | shared                         |

## Problem Statement

A developer or agent needs to find relevant passages across a repo's ingested
context (CLAUDE.md, ADRs, team docs) without knowing which file holds them.
`search_context` is the keyword/passage search over that corpus — backed by the
hybrid vector+BM25 store when a database is available, and degrading to a
deterministic file-system text scan when it is not, so it works locally before
any ingest has run.

## Interface

Registered via `server.tool` ([registration](../../../mcp-server/src/mcp/tools/context-tools.ts#L23)).

- **name**: `search_context`
- **description** (verbatim): *"Naive case-insensitive text search across all .md
  files in the context repository."*

### Input schema (Zod)

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `query` | string | yes | — | Natural-language search query. |
| `team` | string | no | — | Scope to a team schema/subtree. Omitted ⇒ org-wide. |
| `limit` | number | no | `8` | Max results returned. |

## Behavior

1. **Repo auto-detect** — when no `team` is given, call `detectCurrentRepo()` and
   log `"[lore] search_context: auto-detected repo {repo}"` to stderr (advisory).
2. **DB path** — if `isDbAvailable()`:
   1. `schema = team || "org_shared"`; `results = hybridSearch(query, schema, limit)`
      ([hybridSearch](../../../mcp-server/src/platform/db.ts#L120) — HNSW vector +
      BM25, fused by RRF).
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

A matching paragraph is returned with its source path. ([validated by `returns the matching paragraph with its source path`](../../../mcp-server/src/mcp/tools/context-tools.test.ts#L49))

Matching is case-insensitive. ([validated by `matches case-insensitively`](../../../mcp-server/src/mcp/tools/context-tools.test.ts#L56))

Paragraphs that do not contain the query are excluded. ([validated by `excludes paragraphs that do not contain the query`](../../../mcp-server/src/mcp/tools/context-tools.test.ts#L61))

When nothing matches, a no-results message is returned. ([validated by `returns a no-results message when nothing matches`](../../../mcp-server/src/mcp/tools/context-tools.test.ts#L66))

The number of returned paragraphs is capped at `limit`. ([validated by `caps the number of returned paragraphs at the limit`](../../../mcp-server/src/mcp/tools/context-tools.test.ts#L73))

A `team` scopes the search to that team subtree. ([validated by `scopes the search to a team subtree when team is given`](../../../mcp-server/src/mcp/tools/context-tools.test.ts#L79))

An unknown team yields a path-not-found error. ([validated by `returns a path-not-found error for an unknown team`](../../../mcp-server/src/mcp/tools/context-tools.test.ts#L88))

The DB (hybrid-search) branch is exercised only against live Postgres + Vertex
embeddings. *(untested: `hybridSearch` requires a live pgvector store and the
result-formatting is inline in the handler with no extractable seam; the
file-fallback branch above is fully covered.)*

## Out of Scope

- Hybrid vector+BM25 ranking internals (RRF) — owned by the retrieval layer.
- Embedding generation.
- Ingesting `.md` files into the store (see the ingest tools).
