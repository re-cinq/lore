# Feature Specification: GET /api/context

| Field      | Value                                          |
|------------|------------------------------------------------|
| Feature    | Context assembly HTTP route                     |
| Status     | **Draft**                                       |
| Created    | 2026-06-10                                      |
| Owner      | Platform Engineering                           |
| Route      | `GET /api/context`                             |
| Auth scope | `read`                                          |
| Module     | `mcp-server/src/api/routes/context.ts` (`handleContext`) |

## Problem Statement

Clients that cannot run the assembly engine locally — the stdio MCP proxy when
the memory DB is unavailable, the pre-run context hydration in the local + GKE
runners, and the web UI — need an HTTP surface that returns a token-budgeted,
provenance-tagged context block for a query, or a plain concatenation of a repo's
docs/ADRs/specs when no query is supplied. This is the read counterpart to the
`lore_assemble_context` MCP tool over HTTP.

## Interface

- **Method + path**: `GET /api/context`
- **Auth**: bearer token with `read` scope. `getRequiredScope` maps the
  `/api/context` prefix → `read`. Missing bearer → 401; insufficient scope → 403
  (dispatcher).

### Request — query params

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `query` | string | no | — | Natural-language context query. When present (with a pool) selects the assembly-engine path. |
| `repo` | string | no | — | `owner/name`. Drives the no-query chunk-join path; passed to the engine when a query is present. |
| `template` | string | no | `"default"` | Template name forwarded to `assembleContext`. |
| `debug` | string | no | — | `"1"` or `"true"` enables the engine debug trace. Any other value → false. |

### Response

Always `200` (success or empty) or `500` (engine throw). JSON only.

| Branch | Body |
|--------|------|
| query + pool | `{ "text": <string\|null>, "sections": [...], "trace": <trace\|undefined> }` |
| no query, repo + pool, chunks found | `{ "text": "<chunk>\n\n---\n\n<chunk>…" }` |
| no query, no chunks / no repo / no pool | `{ "text": null }` |
| engine throw | `{ "error": "<message>" }` (500) |

## Behavior

1. Parse `req.url` with base `http://localhost`. Read `repo`, `query`,
   `template` (default `"default"`), and `debug` (`"1"` or `"true"` → true).
2. **Assembly path** — if `query` is truthy **and** `pool` is non-null:
   1. `await assembleContext(pool, query, template, 8000, repo || undefined,
      undefined, undefined, undefined, debug)` — max-tokens fixed at 8000.
   2. Write 200 `{ text: result.text || null, sections: result.sections,
      trace: result.trace }`. Empty/falsy text is coerced to `null`.
3. **Chunk-join path** (no query, or no pool):
   1. If `repo` **and** `pool` are present, `SELECT content, content_type,
      file_path FROM org_shared.chunks WHERE repo = $1 AND content_type IN
      ('doc','adr','spec') ORDER BY content_type, ingested_at DESC`. Collect
      each row's `content` into `parts`.
   2. Write 200 `{ text: parts.length > 0 ? parts.join("\n\n---\n\n") : null }`.
4. **Catch** — any throw → 500 `{ error: err.message }`.

## Output

- **Assembly success**: 200 `{ text, sections, trace }` (text null when empty;
  trace present only when the engine returns one — `debug=1` requests it).
- **Chunk join**: 200 `{ text: "<joined>" }` or `{ text: null }`.
- **No query/repo/pool**: 200 `{ text: null }`.
- **Engine throw**: 500 `{ error: "<message>" }`.

## Dependencies & side effects

- `assembleContext` (`features/context/context-assembly.ts`) — RRF retrieval +
  XML emission over PostgreSQL, optional Vertex embeddings.
- DB read: `org_shared.chunks` (chunk-join path).
- Auth env `LORE_INGEST_TOKEN`, `pipeline.api_tokens` (dispatcher).
- No writes; no fan-out. (`assembleContext` may write a latency audit row.)

## Acceptance Criteria

A query with a pool returns the assembled `{ text, sections }`. ([validated by `returns assembled context when query + pool present`](../../../mcp-server/src/api/routes/context.test.ts#L21))

`debug=1` is forwarded as the engine's debug flag and the trace is returned in the envelope. ([validated by `passes debug=1 through and returns the trace in the envelope`](../../../mcp-server/src/api/routes/context.test.ts#L29))

Empty engine text is coerced to `null`. ([validated by `nulls text when assembleContext returns empty text`](../../../mcp-server/src/api/routes/context.test.ts#L38))

No query but a repo + pool joins the matching chunks with the `---` separator. ([validated by `joins repo chunks when no query but repo + pool present`](../../../mcp-server/src/api/routes/context.test.ts#L46))

An empty chunk set returns `{ text: null }`. ([validated by `nulls text when repo chunks are empty`](../../../mcp-server/src/api/routes/context.test.ts#L54))

Neither query nor repo returns `{ text: null }`. ([validated by `nulls text when neither query nor repo provided`](../../../mcp-server/src/api/routes/context.test.ts#L62))

A throwing engine returns 500. ([validated by `returns 500 when assembleContext throws`](../../../mcp-server/src/api/routes/context.test.ts#L68))

The route is registered as a `GET /api/context` prefix match. ([implemented by](../../../mcp-server/src/api/routes/index.ts#L55)) ([implemented by](../../../mcp-server/src/api/routes/context.ts#L6))

## Out of Scope

- The retrieval/ranking/XML assembly engine internals (`assembleContext`).
- Template authoring and token-budget tuning.
- Cross-repo resolution (the HTTP route never enables cross-repo; the MCP tool does).
- Bearer-token validation mechanics (owned by `auth.ts`).
