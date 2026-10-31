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
the memory DB is unavailable, the `lore_assemble_context` call an agent pod
makes for itself, and the web UI — need an HTTP surface that returns a token-budgeted,
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
| `backend` | string | no | repo's `settings.context_backend`, then `"utopia"` | `lore`, `utopia` or `both` (ADR-052 amendment 2026-10-16); anything else → 400. |

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
   1. `await assembleContext(pool, query, { templateName, maxTokens, repo,
      agentId, crossRepo, debug, dgraph })` — `maxTokens` is the `max_tokens`
      query parameter, 8000 when absent or non-numeric and capped at 128000.
   2. Write 200 `{ text: result.text || null, sections: result.sections,
      trace: result.trace }`. Empty/falsy text is coerced to `null`.
3. **Chunk-join path** (no query, or no pool):
   1. If `repo` **and** `pool` are present, resolve the repo's chunk schema
      (provisioned team schema, else `org_shared`) via the shared
      `resolveChunkSchemaForRepo`, then `SELECT content, content_type,
      file_path FROM {schema}.chunks WHERE repo = $1 AND content_type IN
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
- DB read: the repo's resolved chunk schema — team schema when provisioned,
  else `org_shared` (chunk-join path).
- Auth env `LORE_INGEST_TOKEN`, `pipeline.api_tokens` (dispatcher).
- No writes; no fan-out. (`assembleContext` may write a latency audit row.)

## Acceptance Criteria

A query with a pool returns the assembled `{ text, sections }`. ([validated by `returns assembled context when query + pool present`](apps/lore-api/src/transport/routes/context/context.test.ts#L39), [validated by `context.test.ts:31`](apps/lore-api/src/transport/routes/context/context.test.ts#L39))

`max_tokens`, `agent_id`, and `cross_repo` query params are forwarded to `assembleContext` at their respective argument positions. ([validated by `context.test.ts:71`](apps/lore-api/src/transport/routes/context/context.test.ts#L80))

The max-tokens budget defaults to 8000 when `max_tokens` is absent or non-numeric. ([validated by `context.test.ts:89`](apps/lore-api/src/transport/routes/context/context.test.ts#L98))

Cross-repo search is enabled from the repo's `settings.cross_repo` when the `cross_repo` param is not set. ([validated by `context.test.ts:107`](apps/lore-api/src/transport/routes/context/context.test.ts#L116))

An unknown `template` name is rejected with 400. ([validated by `context.test.ts:209`](apps/lore-api/src/transport/routes/context/context.test.ts#L218))

*(added 2026-10-16)* An optional `backend` (`lore`, `utopia`, `both`) is forwarded to `assembleContext`; an unknown backend is rejected with 400. ([validated by returns 400 for a backend of dgraph](apps/lore-api/src/transport/routes/context/context.test.ts#L224), [validated by assembles from utopia when the request names backend=utopia over a repo set to both](apps/lore-api/src/transport/routes/context/context.test.ts#L230))

With no `backend` param the repo's `settings.context_backend` decides, read in the same settings lookup as `cross_repo`, and `utopia` when the repo names none. ([validated by assembles from both when the request names no backend and the repo's context_backend is both](apps/lore-api/src/transport/routes/context/context.test.ts#L242))

`debug=1` is forwarded as the engine's debug flag and the trace is returned in the envelope. ([validated by `context.test.ts:41`](apps/lore-api/src/transport/routes/context/context.test.ts#L49))

Empty engine text is coerced to `null`. ([validated by `context.test.ts:121`](apps/lore-api/src/transport/routes/context/context.test.ts#L130))

No query but a repo + pool joins the matching chunks with the `---` separator. ([validated by `context.test.ts:131`](apps/lore-api/src/transport/routes/context/context.test.ts#L140))

The no-query chunk join reads from the repo's provisioned team schema, falling back to `org_shared`. ([validated by `joins the no-query chunks from the repo's provisioned team schema`](apps/lore-api/src/transport/routes/context/context.test.ts#L151))

The no-query chunk join keeps whole chunks until the `max_tokens * 4` char budget is hit (default 8000 tokens, server-capped at 128000), never the whole table; the first chunk is always included even when it alone exceeds the budget. ([validated by `context.test.ts:158`](apps/lore-api/src/transport/routes/context/context.test.ts#L167), [validated by `context.test.ts:175`](apps/lore-api/src/transport/routes/context/context.test.ts#L184), [validated by `context.test.ts:98`](apps/lore-api/src/transport/routes/context/context.test.ts#L107))

An empty chunk set returns `{ text: null }`. ([validated by `context.test.ts:187`](apps/lore-api/src/transport/routes/context/context.test.ts#L196))

Neither query nor repo returns `{ text: null }`. ([validated by `context.test.ts:196`](apps/lore-api/src/transport/routes/context/context.test.ts#L205))

A throwing engine returns 500. ([validated by `context.test.ts:202`](apps/lore-api/src/transport/routes/context/context.test.ts#L211))

An assembly writes one line `[context] assembled backend=<lore|utopia|both> repo=<owner/name> template=<name> sections=<sections that kept content> tokens=<n> ms=<total>`. *(2026-10-31)* ([validated by logs backend=utopia, repo o/r, template default, sections docs and tokens=120 for an assembly that kept one docs document](../../../apps/lore-api/src/transport/routes/context/context.test.ts#L294))

An assembly counts one `lore_context_assembly_total` by `backend` and `outcome`: `ok` when a section kept content, `empty` when none did. *(2026-10-31)* ([validated by counts an ok utopia assembly, then an empty one with no kept section](../../../apps/lore-api/src/transport/routes/context/context.test.ts#L311))

A throwing assembly counts `outcome=error` and returns 500. *(2026-10-31)* ([validated by counts outcome=error and answers 500 when the assembly throws](../../../apps/lore-api/src/transport/routes/context/context.test.ts#L330))

The trace the report reads is kept in memory only; the response carries it only when `debug` is set. *(2026-10-31)* ([validated by omits the trace from the response when debug is not set](../../../apps/lore-api/src/transport/routes/context/context.test.ts#L347))

The route is registered as a `GET /api/context` prefix match. ([implemented by](../../../apps/lore-api/src/app/build-server.ts#L104), [implemented by](../../../apps/lore-api/src/transport/routes/context/context.ts#L52))

## Out of Scope

- The retrieval/ranking/XML assembly engine internals (`assembleContext`).
- Template authoring and token-budget tuning.
- Cross-repo resolution (the HTTP route never enables cross-repo; the MCP tool does).
- Bearer-token validation mechanics (owned by `auth.ts`).
