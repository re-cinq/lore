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

`lore_search_context` searches a repo's ingested document corpus for matching passages via hybrid vector plus BM25 retrieval, run by the Lore API.

## Problem Statement

A developer or agent needs to find relevant passages across a repo's ingested
context (CLAUDE.md, ADRs, team docs) without knowing which file holds them.
`lore_search_context` is the keyword/passage search over that corpus — backed by the
hybrid vector+BM25 store behind the Lore API. *(2026-11-02)* The local
file-system text scan it once fell back to is gone: the install has no offline
mode, and a grep over one checkout answered a natural-language question with
nothing.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/transport/tools/context/search-context.ts)).

- **name**: `lore_search_context`
- **description** (verbatim):

```text
Searches the repo/org ingested-document corpus (CLAUDE.md, ADRs, team docs, specs) and returns raw matching passages as source-scored snippets. Uses hybrid vector+BM25 retrieval over the ingested corpus, through the Lore API.
Use this when you want chunk-level evidence or the exact wording of a convention/ADR. For a ONE token-budgeted bundle combining all sources (conventions, ADRs, memories, facts, graph) call lore_assemble_context — that is the mandatory first call. For past learnings, decisions, and extracted facts from prior sessions call lore_search_memory. For entity relationships call lore_query_graph.
```

### Input schema (Zod)

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `query` | string | yes | — | Natural-language search query. |
| `team` | string | no | — | Team schema name to scope the search (e.g. 'platform'). Omit to search org_shared; an unknown team falls back to org_shared. |
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
   the corpus at all. ([validated by `answers a natural-language query with scored passages carrying their source path` @4a7c1614](apps/lore-api/src/transport/routes/context/search-context.test.ts#L69), [`sends 0.0163 as a number when pg hands back the numeric as a string` @5243f6c2](apps/lore-api/src/transport/routes/context/search-context.test.ts#L96), [`retries a provisioned team schema's miss against org_shared` @7f4d91f3](apps/lore-api/src/transport/routes/context/search-context.test.ts#L112), [`refuses an empty query with 400 before searching` @dbf711a9](apps/lore-api/src/transport/routes/context/search-context.test.ts#L134), [validated by says no results for deploys when the API matches nothing @e525c16a](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L111))

4. **No API** — the tool says the corpus search needs `LORE_API_URL` rather than
   answer from local files. ([validated by says the corpus search needs LORE_API_URL instead of scanning local files @1d1519e3](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L28))

## Output

A single MCP text content block, never a throw: the formatted result list
(`**Score:**`), the no-results string, or why the API could not answer (not
configured, denied, or the server's own reason). ([validated by forwards backend=both to GET /api/search-context and prints the API's no-reader note after the passages @2361ff99](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L66), [validated by says no results for deploys when the API matches nothing @e525c16a](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L111), [validated by says the corpus search needs LORE_API_URL instead of scanning local files @1d1519e3](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L28))

## Dependencies & side effects

- `proxyGetApi()` (`GET /api/search-context`), `detectCurrentRepo()`,
  `traceRetrieval()` (OTEL span).

### Rationale

The request and the passages are typed from lore-api's OpenAPI document
(`apps/mcp-server/src/transport/api/schema.d.ts`), so a field the API renames
fails the MCP server's type check. ([implemented by @ba5418af](apps/mcp-server/src/transport/api/api-types.ts#L37))

## Acceptance Criteria

`hybridSearch` searches a provisioned team schema directly. ([validated by `searches a provisioned team schema directly` @e4880143](libs/server-core/src/outbound/db.test.ts#L29))

`hybridSearch` falls back to `org_shared` for an unprovisioned schema. ([validated by `falls back to org_shared for an unprovisioned schema` @ddc100bc](libs/server-core/src/outbound/db.test.ts#L46))

`hybridSearch` falls back to `org_shared` for an injection-shaped schema name without an existence check. ([validated by `falls back to org_shared for an injection-shaped schema without an existence check` @e0754f21](libs/server-core/src/outbound/db.test.ts#L59))

`hybridSearch` uses `websearch_to_tsquery` with extracted key terms for the BM25 leg, not `plainto_tsquery` over the full natural-language query. ([validated by @d88b3e20](libs/server-core/src/outbound/db-hybrid-defects.test.ts#L31))

`hybridSearch` normalises returned `rrf_score` values so the highest-ranked result is 1.0 rather than a raw RRF fraction near 1/61. ([validated by @53eadc12](libs/server-core/src/outbound/db-hybrid-defects.test.ts#L43))

`hybridSearch` binds the search to a specific repo so results from other repos are excluded. ([validated by @aa0e4ce6](libs/server-core/src/outbound/db-hybrid-defects.test.ts#L68))

*(added 2026-10-16, ADR-052 amendment "reads choose a backend")* An optional `backend` param (`lore`, `utopia`, `both`) is forwarded to `GET /api/search-context`, and the API's notes are printed after the passages. ([validated by forwards backend=both to GET /api/search-context and prints the API's no-reader note after the passages @2361ff99](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L169))

`GET /api/search-context` answers `utopia` with no mirror to read with the note `search_context: no Utopia reader yet`, without searching Lore; `both` with Lore's passages and that note; an unknown backend with 400; and `lore` with Lore's passages and no `notes`. ([validated by answers a natural-language query with scored passages carrying their source path @4a7c1614](apps/lore-api/src/transport/routes/context/search-context.test.ts#L69), [validated by answers the no-reader note for backend=utopia with repo=o/r when the repo has no mirror @7f888f0e](apps/lore-api/src/transport/routes/context/search-context.test.ts#L187), [validated by answers Lore's passages plus the no-reader note for backend=both without a repo @c2fba728](apps/lore-api/src/transport/routes/context/search-context.test.ts#L224), [validated by refuses a backend of dgraph with 400 @cb23d451](apps/lore-api/src/transport/routes/context/search-context.test.ts#L242))

A request naming no backend is answered as `utopia` (2026-10-28). ([validated by answers no passages and a no-reader note when the request names no repo, without searching Lore @603e4d52](apps/lore-api/src/transport/routes/context/search-context.test.ts#L143), [validated by asks the agent gateway's caller for the repo when the call names none @26ce1fad](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L178), [validated by is true for utopia and both, false for lore and an omitted backend @6cd686d5](apps/mcp-server/src/transport/tools/shared/backend-param.test.ts#L15))

*(2026-10-31)* With `repo` (`owner/name`) and a Utopia reader, `GET /api/search-context` reads the repo's `docs` source (`settings.utopia`): one passage per document, in the order of its best hit, scored so the best is 1, each carrying `backend: "utopia"`. ([validated by answers the repo's docs-source documents scored so the best is 1 for repo=o/r with no backend @5e3eaed9](apps/lore-api/src/transport/routes/context/search-context.test.ts#L155))

*(2026-10-31)* Under `both` with a repo, Lore's passages come first, each carrying `backend: "lore"`, then Utopia's. ([validated by answers Lore's passages first, then Utopia's, each labelled, for backend=both with repo=o/r @f0c08fb1](apps/lore-api/src/transport/routes/context/search-context.test.ts#L198))

*(2026-10-31)* The tool takes `repo` (required in agent mode, auto-detected from the git remote on a laptop) and forwards it to `GET /api/search-context`; a repo that is not `owner/name` is refused before the API is asked. ([validated by forwards repo=owner/r and team payments to GET /api/search-context for the default backend @7cd9fd44](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L91), [validated by refuses repo 'not a repo' before asking the API @a63a20bb](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L162), [validated by logs the repo it detected from the checkout when the call names no team @9e4ccea7](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L126), [validated by sends no repo from a directory outside any checkout @713dd116](apps/mcp-server/src/transport/tools/context/search-context.test.ts#L140), [validated by accepts an omitted backend and refuses one it does not know @dae386ba](apps/mcp-server/src/transport/tools/shared/backend-param.test.ts#L5))

## Out of Scope

- Hybrid vector+BM25 ranking internals (RRF) — owned by the retrieval layer.
- Embedding generation.
- Ingesting `.md` files into the store (see the ingest tools).
