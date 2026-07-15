# Feature Specification: Generate an OpenAPI 3.1 document for lore-api

| Field    | Value                                                              |
|----------|-------------------------------------------------------------------|
| Feature  | Derive an OpenAPI 3.1 document from the zod route schemas and serve it (JSON + Redoc UI) |
| Status   | Complete                                                       |
| Created  | 2026-07-06                                                        |
| Owner    | Platform Engineering                                             |
| ADR      | [ADR-035](../../adrs/ADR-035-lore-api-openapi.md) — builds on [ADR-034](../../adrs/ADR-034-lore-api-request-validation.md) / [ADR-033](../../adrs/ADR-033-lore-api-hapi.md) |

## Problem Statement

lore-api serves ~50 `/api/*` operations across ~30 hapi routes, and there is **no
machine-readable description of that surface**. A client (the mcp-server proxy,
the web UI, CI, a new engineer) learns the contract by reading route source. That
was unavoidable while every route parsed and validated its own body by hand — the
contract lived inside imperative handler code.

[ADR-034](../../adrs/ADR-034-lore-api-request-validation.md) changed that. Request
validation now lives in hapi's `options.validate` via a shared zod adapter
([`zodValidate`](../../apps/lore-api/src/server/plugins/zod-validate.ts)): each
converted route **declares** its request contract as a zod schema. ADR-034's own
consequences call this out — *"Declarative schemas are the substrate an OpenAPI
document is generated from — this unblocks that follow-on feature."* This is that
follow-on. It was explicitly parked in
[hapi-request-validation's Out of Scope](../hapi-request-validation/spec.md#L162).

Two facts make the generation tractable and shape the design:

- The routes are registered in **one place** —
  [`build-server.ts`](../../apps/lore-api/src/server/build-server.ts) `server.route([...])` —
  and each carries its `method`, `path`, required scope
  (`options.plugins["bearer-scope"].scope`), and, where converted, its zod payload
  schema (`options.validate.payload`). The route array is already the single
  source of truth; ADR-033 deliberately deleted the parallel URL→scope map.
- The zod payload schema is currently wrapped by `zodValidate(schema)` and the raw
  schema is **not recoverable** from the returned validation function. Generation
  needs it back.

## Solution

Walk the **same route array the server registers** and project each route into an
OpenAPI 3.1 operation. Convert each route's zod schema to a JSON Schema object with
[`zod-to-json-schema`](../../apps/lore-api/package.json) — **already resolved in the
repo lockfile** (`3.25.2`, zod-v3-native), so no new dependency subtree. Serve the
result at `GET /api/openapi.json` and render it with Redoc at `GET /api/docs`.

### Making the schema reachable (least-invasive)

`zodValidate(schema)` stamps the raw schema onto the function it returns
(`fn.zodSchema = schema`); a `getZodSchema(fn)` reader recovers it. The route
array is hoisted out of `build-server.ts` into a shared `routeList(getPool)` that
both `buildServer` and the generator consume. **No route definition changes; no
parallel registry; no second source of truth** — the generator reads exactly what
the server runs. (Design fork 1.)

### zod → JSON Schema (fewest elements)

`zod-to-json-schema` is already in the tree (transitive; top-level in
`node_modules`). OpenAPI 3.1's schema dialect is JSON Schema 2020-12, so the
converter's output embeds directly into each operation's `requestBody`. We
**reject** `@asteasolutions/zod-to-openapi` (absent; a fresh dependency subtree) on
the same fewest-elements axis ADR-033/034 used to reject joi and fastify. We own
the OpenAPI envelope assembly (paths, security, responses) — which we must own
regardless, since a schema converter knows nothing of hapi routes, scopes, or rate
buckets. (Design fork 2; recorded in ADR-035.)

### Partial coverage — lift where zod exists, freeform where it doesn't

Four routes validate via **domain validators**, not `options.validate`, and stay
that way (ADR-034 §5 kept transforming validators in their handlers):

- **agents** (`agents.ts`) — the domain validator IS an exported zod schema
  ([`AgentInputSchema`](apps/lore-api/src/features/agents/agents-schema.ts)).
- **dark-factory** (`dark-factory.ts`) — likewise
  ([`DarkFactorySettingsSchema`](apps/lore-api/src/features/dark-factory/dark-factory-settings.ts)).
- **features** (`features.ts`) — hand-rolled (`enforceFeatureInput`,
  `parseSectionAnswers`, `parseGapResult`); no single zod schema.
- **tokens** (`tokens.ts`) — a plain TS interface + residual `if` checks.

The generator carries a small **domain-route sidecar**: for agents and
dark-factory it references the existing exported zod schema (accurate body, zero
new schema code); for features and tokens it emits a **freeform** `object` body and
records them as uncovered. The sidecar also supplies the concrete verbs for the two
`method: "*"` routes (dark-factory: GET/PUT; tokens: GET/POST), which hapi expresses
as a wildcard the doc cannot. The sidecar is the **one** place fork-3 exceptions are
declared — and the drift guard cross-checks it. (Design fork 3.)

### Representing auth, scope, and rate limits

- A single `bearerAuth` **security scheme** (`http`, `scheme: bearer`).
- Authed operations carry `security: [{ bearerAuth: [] }]`; public ones (webhooks,
  which self-verify via HMAC) carry `security: []`.
- Per-route required scope is a `x-required-scope` extension on the operation (HTTP
  bearer security has no first-class scope list, unlike oauth2 — a custom extension
  is the honest representation, not a faked oauth2 flow), echoed in the operation
  description.
- The rate-limit bucket (`webhook` / `task` / `default`) is a `x-rate-limit-bucket`
  extension, derived from the same path rule the
  [rate-limit plugin](../../apps/lore-api/src/server/plugins/rate-limit.ts) uses.
- Shared error responses (`400` validation, `401` missing token, `403` scope,
  `413` body cap, `429` rate limit, `503` db-unavailable) are `components.responses`
  entries referenced by operations, so the uniform `{ error }` envelope is
  documented once. (Design fork 4.)

The document is **request-focused**: we have declarative schemas for request bodies
and the error envelope, not for success bodies. Each operation carries a single
`200` success entry with a description only (no `content` schema — the code returns
2xx but the body shape is not declaratively known, so none is invented). This is
stated in `info.description`.

### Surface

- `GET /api/openapi.json` — **read scope** (consistent with every other read route
  on this fully-authenticated backend). Returns the generated document.
- `GET /api/docs` — **read scope** — an HTML page that renders the spec with Redoc.
  Because a browser cannot attach a bearer to a second cross-origin fetch, the page
  **inlines the generated document** and calls `Redoc.init(spec, …)`: one
  read-scoped gate, no second fetch. Reaching the page needs a read token like every
  other `/api/*` route (typically via an authenticating proxy / internal tooling).
  Redoc's JS loads from its CDN. (Design fork 4.)

Both routes are registered in `routeList` alongside the rest — and are therefore
described by the very document they serve.

### Drift guard

A test builds the document from `routeList(() => null)` and asserts:

- Every route whose method can carry a body (`POST`/`PUT`/`DELETE`/`*`) either
  declares a `zodValidate` payload schema **or** is in the documented-freeform
  sidecar allowlist. A new body-bearing route added with neither **fails the test** —
  the doc cannot silently rot. (Design fork 5.) ([validated by `coverage.test.ts:18`](apps/lore-api/src/openapi/coverage.test.ts#L18))
- Every `/api/*` route appears exactly once in `paths` (catch silent drops); the two
  operational non-API paths (`/healthz`, `/dist/*`) are the only documented
  exclusions.
- The output is a structurally valid OpenAPI 3.1 document (`openapi: "3.1.0"`,
  `info`, `paths`, `components.securitySchemes.bearerAuth`). An external OpenAPI
  linter validates the **served** document in the verification step. ([validated by `coverage.test.ts:65`](apps/lore-api/src/openapi/coverage.test.ts#L65))

## Functional Requirements

- **FR1** `zodValidate(schema)` stamps the raw zod schema onto the validation
  function it returns; `getZodSchema(fn)` recovers it. Validation behavior
  (parse → typed data → `{ error }` 400) is unchanged. ([validated by `zod-validate.test.ts:29`](apps/lore-api/src/server/plugins/zod-validate.test.ts#L29), [`zod-validate.test.ts:17`](apps/lore-api/src/server/plugins/zod-validate.test.ts#L17))
- **FR2** The route array is hoisted into a shared `routeList(getPool)` consumed by
  both `buildServer` and the generator. No route definition changes; no parallel
  registry.
- **FR3** `buildOpenApiDocument(routes)` produces an OpenAPI **3.1.0** document
  covering every `/api/*` route: path (hapi `{p}`/`{p?}` → OpenAPI param, required
  reflecting optionality), method(s), required-scope extension, rate-limit-bucket
  extension, `requestBody` (converted zod schema for covered routes; lifted domain
  schema for agents/dark-factory; freeform `object` for features/tokens), and the
  shared error responses. ([validated by `build-document.test.ts:29`](apps/lore-api/src/openapi/build-document.test.ts#L29))
- **FR4** Auth is modelled as a `bearerAuth` security scheme; authed operations set
  `security: [{ bearerAuth: [] }]`, HMAC webhook operations set `security: []`. ([validated by `build-document.test.ts:13`](apps/lore-api/src/openapi/build-document.test.ts#L13), [`build-document.test.ts:148`](apps/lore-api/src/openapi/build-document.test.ts#L148))
- **FR5** `GET /api/openapi.json` (read scope) serves the document. `GET /api/docs`
  (read scope) serves a Redoc HTML page with the document **inlined**. ([validated by `openapi.test.ts:28`](apps/lore-api/src/api/routes/openapi/openapi.test.ts#L28), [`openapi.test.ts:63`](apps/lore-api/src/api/routes/openapi/openapi.test.ts#L63))
- **FR6** Request-body schemas are converted with `zod-to-json-schema` (already a
  resolved dependency); no new dependency subtree is introduced. `@asteasolutions/
  zod-to-openapi` is not adopted.
- **FR7** Non-API operational paths (`/healthz`, `/dist/*`) are excluded from the
  document and the exclusion is logged, not silent. ([validated by `build-document.test.ts:45`](apps/lore-api/src/openapi/build-document.test.ts#L45), [`coverage.test.ts:42`](apps/lore-api/src/openapi/coverage.test.ts#L42))

## Success Criteria

- **SC-1** `GET /api/openapi.json` returns a document that passes an external
  OpenAPI 3.1 linter (`npx @redocly/cli lint` in the verification step).
- **SC-2** Every `/api/*` route registered in `routeList` appears exactly once in
  the document's `paths` (asserted by test). The `*` routes (dark-factory, tokens)
  expand to their real verbs. ([validated by `coverage.test.ts:34`](apps/lore-api/src/openapi/coverage.test.ts#L34), [`build-document.test.ts:111`](apps/lore-api/src/openapi/build-document.test.ts#L111))
- **SC-3** Every covered write route's `requestBody` schema round-trips its zod
  contract: a required field is `required`, an enum is an `enum`, the memory
  discriminated union is a `oneOf`/discriminator. Proven by generator unit tests. ([validated by `build-document.test.ts:81`](apps/lore-api/src/openapi/build-document.test.ts#L81), [`build-document.test.ts:72`](apps/lore-api/src/openapi/build-document.test.ts#L72))
- **SC-4** A body-bearing route with neither a `zodValidate` schema nor a sidecar
  allowlist entry fails the drift-guard test (proven by a fixture route in the
  test). ([validated by `coverage.test.ts:22`](apps/lore-api/src/openapi/coverage.test.ts#L22))
- **SC-5** Per-route scope and rate-limit bucket appear as `x-required-scope` /
  `x-rate-limit-bucket`; `bearerAuth` is the sole security scheme; webhook
  operations are `security: []`. ([validated by `build-document.test.ts:136`](apps/lore-api/src/openapi/build-document.test.ts#L136))
- **SC-6** `apps/lore-api` typechecks (`tsc --noEmit`), builds (`npm run build`),
  and the full vitest suite is green. Each phase is an independently-revertable
  commit.

## Out of Scope

- **Response body schemas.** The doc describes request contracts (derivable) and the
  error envelope (uniform); it documents success responses generically. Typed
  success schemas are a later feature and would need their own declarative source.
- **Changing any route** — path, method, scope, rate-limit budget, or validation.
  This feature only *reads* the route array. The only new routes are the two that
  serve the doc.
- **OpenAPI-driven client generation** (regenerating the mcp-server proxy or web-UI
  clients from the document). Enabled by this feature; not built here.
- **Migrating domain validators into `options.validate`.** ADR-034 deliberately
  kept transforming validators in their handlers; this feature documents them, it
  does not move them.
- **Adopting `@asteasolutions/zod-to-openapi`** — rejected on fewest-elements
  (ADR-035).
