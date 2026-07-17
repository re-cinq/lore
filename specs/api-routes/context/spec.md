# Feature Specification: GET /api/context

| Field      | Value                                          |
|------------|------------------------------------------------|
| Feature    | Context assembly HTTP route                     |
| Status     | In Progress                                     |
| Created    | 2026-06-10                                      |
| Owner      | Platform Engineering                           |
| Route      | `GET /api/context`                             |
| Auth scope | `read`                                          |
| Module     | `mcp-server/src/api/routes/context.ts` (`handleContext`) |

GET /api/context returns a token-budgeted, provenance-tagged context block for a query, or a plain concatenation of a repo's docs, ADRs, and specs when no query is supplied, serving clients that cannot run the assembly engine locally.

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
      each row's `content` into `parts` — whole chunks only, until the next
      chunk (plus separator) would exceed `max_tokens * 4` chars. Unbounded,
      this path returned ~3 MB for an empty query regardless of `max_tokens`
      (2026-07-17).
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

A query with a pool returns the assembled `{ text, sections }`. ([validated by `returns assembled context when query + pool present`](apps/lore-api/src/api/routes/context/context.test.ts#L21), [validated by `context.test.ts:31`](apps/lore-api/src/api/routes/context/context.test.ts#L31))

`max_tokens`, `agent_id`, and `cross_repo` query params are forwarded to `assembleContext` at their respective argument positions. ([validated by `context.test.ts:70`](apps/lore-api/src/api/routes/context/context.test.ts#L70))

The max-tokens budget defaults to 8000 when `max_tokens` is absent or non-numeric. ([validated by `context.test.ts:86`](apps/lore-api/src/api/routes/context/context.test.ts#L86))

Cross-repo search is enabled from the repo's `settings.cross_repo` when the `cross_repo` param is not set. ([validated by `context.test.ts:95`](apps/lore-api/src/api/routes/context/context.test.ts#L95))

An unknown `template` name is rejected with 400. ([validated by `context.test.ts:181`](apps/lore-api/src/api/routes/context/context.test.ts#L181))

`debug=1` is forwarded as the engine's debug flag and the trace is returned in the envelope. ([validated by `context.test.ts:41`](apps/lore-api/src/api/routes/context/context.test.ts#L41))

Empty engine text is coerced to `null`. ([validated by `context.test.ts:109`](apps/lore-api/src/api/routes/context/context.test.ts#L109))

No query but a repo + pool joins the matching chunks with the `---` separator. ([validated by `context.test.ts:119`](apps/lore-api/src/api/routes/context/context.test.ts#L119))

The no-query chunk join keeps whole chunks until the `max_tokens * 4` char budget is hit (default 8000 tokens), never the whole table. ([validated by `context.test.ts:130`](apps/lore-api/src/api/routes/context/context.test.ts#L130), [validated by `context.test.ts:147`](apps/lore-api/src/api/routes/context/context.test.ts#L147))

An empty chunk set returns `{ text: null }`. ([validated by `context.test.ts:159`](apps/lore-api/src/api/routes/context/context.test.ts#L159))

Neither query nor repo returns `{ text: null }`. ([validated by `context.test.ts:168`](apps/lore-api/src/api/routes/context/context.test.ts#L168))

A throwing engine returns 500. ([validated by `context.test.ts:174`](apps/lore-api/src/api/routes/context/context.test.ts#L174))

The route is registered as a `GET /api/context` prefix match. ([implemented by](../../../apps/mcp-server/src/api/routes/index.ts#L55), [implemented by](../../../apps/mcp-server/src/api/routes/context.ts#L6))

## Out of Scope

- The retrieval/ranking/XML assembly engine internals (`assembleContext`).
- Template authoring and token-budget tuning.
- Cross-repo resolution (the HTTP route never enables cross-repo; the MCP tool does).
- Bearer-token validation mechanics (owned by `auth.ts`).
