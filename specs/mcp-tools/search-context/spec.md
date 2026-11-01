# Feature Specification: lore_search_context MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_search_context MCP Tool        |
| Status  | In Progress                    |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_search_context`               |
| Module  | Context (`context/search-context.ts`)   |
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

Registered via `server.tool` ([registration](apps/mcp-server/src/transport/tools/context/search-context.ts)).

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
| `team` | string | no | — | Team schema name to scope the search (e.g. 'platform'). Omit to search org_shared; unknown teams fall back to org_shared on the API path or return an error on the file path. |
| `limit` | number | no | `8` | Maximum passages to return. |

## Behavior

1. **Repo auto-detect** — when no `team` is given, call `detectCurrentRepo()` and
   log `"[lore] lore_search_context: auto-detected repo {repo}"` to stderr (advisory).
2. **No DB path** — the adapter holds no database pool (ADR-032); the hybrid
   retrieval (`hybridSearch`, HNSW vector + BM25 fused by RRF, with the
   org_shared retry) runs server-side behind the API.
3. **API path** (`LORE_API_URL` set) — the adapter holds no database
   (ADR-032), so this is the path a developer laptop actually takes.
   `GET /api/search-context?query&team&limit` runs the same hybrid retrieval
   server-side, including the org_shared retry, and its passages render exactly
   as the server's hybrid search scores them. Before this existed the tool skipped straight to the file
   scan, so a natural-language question — the only kind an agent asks — answered
   `No results found` from a grep over one local checkout while never consulting
   the corpus at all. ([validated by `answers a natural-language query with scored passages carrying their source path`](apps/lore-api/src/transport/routes/context/search-context.test.ts#L69), [`sends 0.0163 as a number when pg hands back the numeric as a string`](apps/lore-api/src/transport/routes/context/search-context.test.ts#L96), [`retries a provisioned team schema's miss against org_shared`](apps/lore-api/src/transport/routes/context/search-context.test.ts#L112), [`refuses an empty query with 400 before searching`](apps/lore-api/src/transport/routes/context/search-context.test.ts#L134), [validated by says no results for deploys when the API matches nothing](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L214))

4. **File fallback** (no API) — the offline path, and it says so: the
   no-results message names the substring scan and points at `LORE_API_URL`,
   because a bare miss from a local grep is otherwise indistinguishable from a
   genuine miss against the corpus. ([validated by says the offline scan is not the corpus when the local files match nothing](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L73))
   1. `searchRoot = team ? {CONTEXT_PATH}/teams/{team} : {CONTEXT_PATH}`
      (`CONTEXT_PATH` env, default `process.cwd()`).
   2. If `searchRoot` does not exist ⇒ return `Error: search path not found at {searchRoot}.`
   3. Glob `**/*.md` (nodir) under the root; for each file split on `/\n{2,}/`
      into paragraphs; push `{ source: relativePath, paragraph: trimmed }` for any
      paragraph containing the lowercased query; stop at `limit`.
   4. `traceRetrieval({ query, namespace: team || "org", topScore: results.length ? 1.0 : 0.0, resultCount })`.
   5. Empty ⇒ return `No results found for "{query}".` *(note: distinct wording from
      the API path's message — preserve both verbatim).*
   6. Else join each as `**Source:** {source}\n\n{paragraph}` with `\n\n---\n\n`.

## Output

A single MCP text content block: either the formatted result list (API form with
`**Score:**`, or file form with `**Source:**`), or one of the two no-results
strings, or the path-not-found error. Never throws.

## Dependencies & side effects

- `proxyGetApi()` (`GET /api/search-context`), `detectCurrentRepo()`,
  `traceRetrieval()` (OTEL span). Filesystem glob/read on the fallback path.
- Env: `CONTEXT_PATH`.

## Acceptance Criteria

A matching paragraph is returned with its source path. ([validated by returns the matching paragraph with its source path](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L45))

Matching is case-insensitive. ([validated by matches case-insensitively](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L56))

Paragraphs that do not contain the query are excluded. ([validated by excludes paragraphs that do not contain the query](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L65))

When nothing matches, a no-results message is returned.

The number of returned paragraphs is capped at `limit`. ([validated by caps the number of returned paragraphs at the limit](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L84))

A `team` scopes the search to that team subtree. ([validated by scopes the search to a team subtree when team is given](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L91))

An unknown team yields a path-not-found error. ([validated by returns a path-not-found error for an unknown team](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L101))

`hybridSearch` searches a provisioned team schema directly. ([validated by `searches a provisioned team schema directly`](libs/server-core/src/outbound/db.test.ts#L29))

`hybridSearch` falls back to `org_shared` for an unprovisioned schema. ([validated by `falls back to org_shared for an unprovisioned schema`](libs/server-core/src/outbound/db.test.ts#L46))

`hybridSearch` falls back to `org_shared` for an injection-shaped schema name without an existence check. ([validated by `falls back to org_shared for an injection-shaped schema without an existence check`](libs/server-core/src/outbound/db.test.ts#L59))

`hybridSearch` uses `websearch_to_tsquery` with extracted key terms for the BM25 leg, not `plainto_tsquery` over the full natural-language query. ([validated by](libs/server-core/src/outbound/db-hybrid-defects.test.ts#L31))

`hybridSearch` normalises returned `rrf_score` values so the highest-ranked result is 1.0 rather than a raw RRF fraction near 1/61. ([validated by](libs/server-core/src/outbound/db-hybrid-defects.test.ts#L43))

`hybridSearch` binds the search to a specific repo so results from other repos are excluded. ([validated by](libs/server-core/src/outbound/db-hybrid-defects.test.ts#L68))

*(added 2026-10-16, ADR-052 amendment "reads choose a backend")* An optional `backend` param (`lore`, `utopia`, `both`) is forwarded to `GET /api/search-context`, and the API's notes are printed after the passages. ([validated by forwards backend=both to GET /api/search-context and prints the API's no-reader note after the passages](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L169))

`utopia` or `both` is answered by the API only: with no API the tool refuses instead of scanning local files, which hold Lore's documents alone. ([validated by refuses backend utopia instead of scanning local files](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L130), [validated by names backend utopia as answered by the Lore API only](apps/mcp-server/src/transport/tools/shared/backend-param.test.ts#L26))

`GET /api/search-context` answers `utopia` with no mirror to read with the note `search_context: no Utopia reader yet`, without searching Lore; `both` with Lore's passages and that note; an unknown backend with 400. A Lore search answers as before, with no `notes`. A request naming no backend is answered as `utopia` (2026-10-28). ([validated by answers no passages and a no-reader note when the request names no repo, without searching Lore](apps/lore-api/src/transport/routes/context/search-context.test.ts#L143), [validated by answers the no-reader note for backend=utopia with repo=o/r when the repo has no mirror](apps/lore-api/src/transport/routes/context/search-context.test.ts#L187), [validated by answers Lore's passages plus the no-reader note for backend=both without a repo](apps/lore-api/src/transport/routes/context/search-context.test.ts#L224), [validated by refuses a backend of dgraph with 400](apps/lore-api/src/transport/routes/context/search-context.test.ts#L242), [validated by skips a .md file it cannot read and still answers from the others](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L111), [validated by asks the agent gateway's caller for the repo when the call names none](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L278), [validated by is true for utopia and both, false for lore and an omitted backend](apps/mcp-server/src/transport/tools/shared/backend-param.test.ts#L15))

*(2026-10-31)* With `repo` (`owner/name`) and a Utopia reader, `GET /api/search-context` reads the repo's `docs` source (`settings.utopia`): one passage per document, in the order of its best hit, scored so the best is 1, each carrying `backend: "utopia"`. ([validated by answers the repo's docs-source documents scored so the best is 1 for repo=o/r with no backend](apps/lore-api/src/transport/routes/context/search-context.test.ts#L155))

*(2026-10-31)* Under `both` with a repo, Lore's passages come first, each carrying `backend: "lore"`, then Utopia's. ([validated by answers Lore's passages first, then Utopia's, each labelled, for backend=both with repo=o/r](apps/lore-api/src/transport/routes/context/search-context.test.ts#L198))

*(2026-10-31)* The tool takes `repo` (required in agent mode, auto-detected from the git remote on a laptop) and forwards it to `GET /api/search-context`; a repo that is not `owner/name` is refused before the API is asked. ([validated by forwards repo=owner/r and team payments to GET /api/search-context for the default backend](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L194), [validated by refuses repo 'not a repo' before asking the API](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L262), [validated by logs the repo it detected from the checkout when the call names no team](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L226), [validated by sends no repo from a directory outside any checkout](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L240), [validated by accepts an omitted backend and refuses one it does not know](apps/mcp-server/src/transport/tools/shared/backend-param.test.ts#L5))

## Out of Scope

- Hybrid vector+BM25 ranking internals (RRF) — owned by the retrieval layer.
- Embedding generation.
- Ingesting `.md` files into the store (see the ingest tools).
