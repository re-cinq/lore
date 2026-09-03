# Feature Specification: Generate an OpenAPI 3.1 document for lore-api

| Field    | Value                                                              |
|----------|-------------------------------------------------------------------|
| Feature  | Derive an OpenAPI 3.1 document from the zod route schemas and serve it (JSON + Redoc UI) |
| Status   | In Progress                                                    |
| Created  | 2026-07-06                                                        |
| Owner    | Platform Engineering                                             |
| ADR      | [ADR-035](../../adrs/ADR-035-lore-api-openapi.md) — builds on [ADR-034](../../adrs/ADR-034-lore-api-request-validation.md) / [ADR-033](../../adrs/ADR-033-lore-api-hapi.md) |

This spec derives an OpenAPI 3.1 document for lore-api from the zod schemas each hapi route already declares, serving it as JSON plus a Redoc UI so clients no longer have to read handler source to learn the roughly fifty-operation API contract.

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
declared — and the drift guard cross-checks it. (Design fork 3.) The coverage report
records tokens + features POSTs as documented freeform and agents + dark-factory as
lifted; the lifted agents body carries its zod fields while features/tokens render a
permissive `object`. ([validated by `build-document.test.ts:52`](apps/lore-api/src/openapi/build-document.test.ts#L52), [validated by `build-document.test.ts:61`](apps/lore-api/src/openapi/build-document.test.ts#L61), [validated by `build-document.test.ts:88`](apps/lore-api/src/openapi/build-document.test.ts#L88), [validated by `build-document.test.ts:96`](apps/lore-api/src/openapi/build-document.test.ts#L96))

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
  the doc cannot silently rot. (Design fork 5.) ([validated by `coverage.test.ts:28`](apps/lore-api/src/openapi/coverage.test.ts#L28), [validated by `build-document.test.ts:41`](apps/lore-api/src/openapi/build-document.test.ts#L41))
- Every `/api/*` route appears exactly once in `paths` (catch silent drops); the two
  operational non-API paths (`/healthz`, `/dist/*`) are the only documented
  exclusions.
- The output is a structurally valid OpenAPI 3.1 document (`openapi: "3.1.0"`,
  `info`, `paths`, `components.securitySchemes.bearerAuth`). An external OpenAPI
  linter validates the **served** document in the verification step. Every operation
  carries a `security` declaration, a `responses` object and a rate-limit bucket, and
  every `requestBody` is an `application/json` schema. ([validated by `coverage.test.ts:123`](apps/lore-api/src/openapi/coverage.test.ts#L123), [validated by `coverage.test.ts:136`](apps/lore-api/src/openapi/coverage.test.ts#L136), [validated by `coverage.test.ts:147`](apps/lore-api/src/openapi/coverage.test.ts#L147))

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
  shared error responses referenced from `components.responses`; the document
  defaults `servers` to the relative root when no `serverUrl` is given. ([validated by `build-document.test.ts:29`](apps/lore-api/src/openapi/build-document.test.ts#L29), [validated by `build-document.test.ts:33`](apps/lore-api/src/openapi/build-document.test.ts#L33), [validated by `build-document.test.ts:211`](apps/lore-api/src/openapi/build-document.test.ts#L211))
- **FR4** Auth is modelled as a `bearerAuth` security scheme; authed operations set
  `security: [{ bearerAuth: [] }]`, HMAC webhook operations set `security: []`. ([validated by `build-document.test.ts:13`](apps/lore-api/src/openapi/build-document.test.ts#L13), [`build-document.test.ts:148`](apps/lore-api/src/openapi/build-document.test.ts#L148))
- **FR4b** A `parse:false` route that declares `options.app.rawBody` is a real raw-body
  API surface (an NDJSON relay), not a handler-verified webhook: its operation carries
  the route's own description and a required request body of the declared content type
  (`type: string`) instead of the generic HMAC boilerplate. ([validated by `build-document.test.ts:230`](apps/lore-api/src/openapi/build-document.test.ts#L230))
- **FR5** `GET /api/openapi.json` (read scope) serves the document. `GET /api/docs`
  (read scope) serves a Redoc HTML page with the document **inlined**. Both gate on
  read scope: a missing bearer is `401` and a token lacking read scope is `403`
  before the handler runs. ([validated by `openapi.test.ts:28`](apps/lore-api/src/api/routes/openapi/openapi.test.ts#L28), [`openapi.test.ts:63`](apps/lore-api/src/api/routes/openapi/openapi.test.ts#L63), [validated by `openapi.test.ts:41`](apps/lore-api/src/api/routes/openapi/openapi.test.ts#L41), [validated by `openapi.test.ts:48`](apps/lore-api/src/api/routes/openapi/openapi.test.ts#L48))
- **FR6** Request-body schemas are converted with `zod-to-json-schema` (already a
  resolved dependency); no new dependency subtree is introduced. `@asteasolutions/
  zod-to-openapi` is not adopted.
- **FR7** Non-API operational paths (`/healthz`, `/dist/*`) are excluded from the
  document and the exclusion is logged, not silent. ([validated by `build-document.test.ts:45`](apps/lore-api/src/openapi/build-document.test.ts#L45), [`coverage.test.ts:102`](apps/lore-api/src/openapi/coverage.test.ts#L102))

- **FR8** Operations are grouped into Redoc sidebar categories: the tags are
  declared in canonical order (only those in use, each with a description), a
  representative operation of each resource carries its tag, and every operation is
  assigned exactly one declared category. ([validated by `build-document.test.ts:160`](apps/lore-api/src/openapi/build-document.test.ts#L160), [validated by `build-document.test.ts:181`](apps/lore-api/src/openapi/build-document.test.ts#L181), [validated by `coverage.test.ts:109`](apps/lore-api/src/openapi/coverage.test.ts#L109))
- **FR9** *(added 2026-08-13)* A route MAY declare its success body, and the Features surface does. `zodResponse(base, schema, opts)` stamps the schema onto `options.plugins.openapi` and the generator registers it as a NAMED component so codegen emits one type per shape rather than an anonymous inline one. It merges onto a base options object rather than returning a standalone one: `bearerScope()` already owns `options.plugins`, so spreading two producers would silently clobber the bearer-scope key and drop the auth scope from every route it touched. A declared contract REPLACES the generic 200 — two success statuses would generate `RealBody | unknown`, which is the same as no type — and one component name registered with two different shapes is a hard error, because the document would serve the second and generate a client type that lies about the first. The coverage guard is scoped to the Features tag: the rest of the surface is request-focused by design, so a document-wide assertion would red-light routes for a contract they never claimed. ([validated by preserves the auth scope it is merged onto](apps/lore-api/src/server/plugins/zod-response.test.ts#L9), [`zod-response.test.ts:22`](apps/lore-api/src/server/plugins/zod-response.test.ts#L22), [`zod-response.test.ts:28`](apps/lore-api/src/server/plugins/zod-response.test.ts#L28), [`zod-response.test.ts:41`](apps/lore-api/src/server/plugins/zod-response.test.ts#L41), [`zod-response.test.ts:53`](apps/lore-api/src/server/plugins/zod-response.test.ts#L53), [`coverage.test.ts:112`](apps/lore-api/src/openapi/coverage.test.ts#L166), [`coverage.test.ts:120`](apps/lore-api/src/openapi/coverage.test.ts#L174), [`coverage.test.ts:137`](apps/lore-api/src/openapi/coverage.test.ts#L191); implemented by [`zod-response.ts:1`](apps/lore-api/src/server/plugins/zod-response.ts#L1))
- **FR10** *(added 2026-08-13)* The document is COMMITTED as `apps/lore-api/openapi.json`, and `apps/web-ui/src/lib/api/schema.d.ts` is generated from it by `openapi-typescript`. Generating inside web-ui is not possible — its Docker context is `apps/web-ui`, so lore-api is unreachable at image-build time — so both artifacts are checked in and `scripts/check-openapi-drift.sh` (the `openapi-drift` PR check) regenerates and diffs them. The write is a CLI entry point, not a module side effect, and carries no environment-derived server URL, no timestamp and no pool: a guard that compares a regenerated file against the committed one turns any environmental input into a red run on an unrelated PR. The guard also fails when an artifact is UNTRACKED, since `git diff` says nothing about a file git does not know. This retires `scripts/type-drift/feature-types.drift.ts` — web-ui's `feature-types.ts` is now aliases over the generated schema rather than 162 hand-written lines. `sectionsOf` stays hand-duplicated in `gap-sections.ts`: it is runtime code a `.d.ts` cannot carry, and the planning pages read `gap_result` straight from Postgres, so no server hop could normalize legacy rows away. ([validated by is written next to lore-api's package.json](apps/lore-api/src/openapi/gen-openapi.test.ts#L12), [`gen-openapi.test.ts:18`](apps/lore-api/src/openapi/gen-openapi.test.ts#L18), [`gen-openapi.test.ts:27`](apps/lore-api/src/openapi/gen-openapi.test.ts#L27), [`gen-openapi.test.ts:39`](apps/lore-api/src/openapi/gen-openapi.test.ts#L39), [`gen-openapi.test.ts:46`](apps/lore-api/src/openapi/gen-openapi.test.ts#L46); implemented by [`gen-openapi.ts:1`](apps/lore-api/src/openapi/gen-openapi.ts#L1))
- **FR11** *(added 2026-08-14)* The web UI consumes this contract rather than the database, and `lore/no-sql-in-web-ui` enforces it: any string or template literal under `apps/web-ui/` that reads as SQL — `SELECT`…`FROM` or `UPDATE`…`SET` across newlines and through `${interpolation}`, `INSERT INTO`, `DELETE FROM`, or DDL — is reported, pointing the author at a lore-api route plus the generated client. Detection requires the keywords UPPERCASE, the casing every query in this repo already uses, because a case-insensitive match flags ordinary UI copy ("Select a repo from the list") and a rule that cries wolf gets disabled rather than obeyed. It runs at `error`. It shipped at `warn` because 143 queries across 51 files predated the contract and a warning marked each as debt without red-lighting a repo that could not be fixed in one change; every one of those queries has since moved behind an lore-api route, `apps/web-ui/src/lib/db.ts` is deleted, and `pg` is no longer a web-ui dependency — so a new query would have to reintroduce the driver to run at all. The rule is what says so at review time rather than at deploy time. ([validated by the same query outside apps/web-ui is out of the rule's boundary](tools/eslint-plugin-lore/rules/no-sql-in-web-ui.test.mjs#L12), [validated by prose whose keywords are not SQL-cased](tools/eslint-plugin-lore/rules/no-sql-in-web-ui.test.mjs#L17), [`no-sql-in-web-ui.test.mjs:22`](tools/eslint-plugin-lore/rules/no-sql-in-web-ui.test.mjs#L22), [`no-sql-in-web-ui.test.mjs:27`](tools/eslint-plugin-lore/rules/no-sql-in-web-ui.test.mjs#L27), [`no-sql-in-web-ui.test.mjs:33`](tools/eslint-plugin-lore/rules/no-sql-in-web-ui.test.mjs#L33), [`no-sql-in-web-ui.test.mjs:39`](tools/eslint-plugin-lore/rules/no-sql-in-web-ui.test.mjs#L39), [`no-sql-in-web-ui.test.mjs:45`](tools/eslint-plugin-lore/rules/no-sql-in-web-ui.test.mjs#L45), [`no-sql-in-web-ui.test.mjs:50`](tools/eslint-plugin-lore/rules/no-sql-in-web-ui.test.mjs#L50), [`no-sql-in-web-ui.test.mjs:55`](tools/eslint-plugin-lore/rules/no-sql-in-web-ui.test.mjs#L55), [`no-sql-in-web-ui.test.mjs:60`](tools/eslint-plugin-lore/rules/no-sql-in-web-ui.test.mjs#L60), [`no-sql-in-web-ui.test.mjs:66`](tools/eslint-plugin-lore/rules/no-sql-in-web-ui.test.mjs#L66), [`no-sql-in-web-ui.test.mjs:72`](tools/eslint-plugin-lore/rules/no-sql-in-web-ui.test.mjs#L72); implemented by [`no-sql-in-web-ui.mjs:1`](tools/eslint-plugin-lore/rules/no-sql-in-web-ui.mjs#L1))

## Success Criteria

- **SC-1** `GET /api/openapi.json` returns a document that passes an external
  OpenAPI 3.1 linter (`npx @redocly/cli lint` in the verification step).
- **SC-2** Every `/api/*` route registered in `routeList` appears exactly once in
  the document's `paths` (asserted by test). The `*` routes (dark-factory, tokens)
  expand to their real verbs, merging every verb at a shared path and normalizing a
  hapi optional path param to `required: true` with an "optional" note. ([validated by `coverage.test.ts:44`](apps/lore-api/src/openapi/coverage.test.ts#L44), [`build-document.test.ts:111`](apps/lore-api/src/openapi/build-document.test.ts#L111), [validated by `build-document.test.ts:123`](apps/lore-api/src/openapi/build-document.test.ts#L123))
- **SC-3** Every covered write route's `requestBody` schema round-trips its zod
  contract: a required field is `required`, an enum is an `enum`, the memory
  discriminated union is a `oneOf`/discriminator. Proven by generator unit tests. ([validated by `build-document.test.ts:81`](apps/lore-api/src/openapi/build-document.test.ts#L81), [`build-document.test.ts:72`](apps/lore-api/src/openapi/build-document.test.ts#L72))
- **SC-4** A body-bearing route with neither a `zodValidate` schema nor a sidecar
  allowlist entry fails the drift-guard test (proven by a fixture route in the
  test). ([validated by `coverage.test.ts:32`](apps/lore-api/src/openapi/coverage.test.ts#L32))
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

- **FR12** *(added 2026-08-20)* A path that multiplexes verbs declares ONE CONTRACT PER VERB. The generator stamps a route's contract onto every method that route serves, so `/api/tokens` and the dark-factory settings path — one `method: "*"` route each — could only be declared as the union of both answers, leaving a generated client to narrow "the list or the write acknowledgement" on a verb that only ever returns one of them. Each is split into concrete per-verb routes with its own contract; the wildcard route that remains at each path exists ONLY to answer 405, because hapi meets an unmatched verb on a matched path with a 404 and "you may not DELETE this" is the better answer. A 405 fallback declares nothing and is absent from the wildcard-verb sidecar, so it contributes no operation and cannot quietly re-add the union. `POST /api/memory` is NOT split: its action rides in the body, so every caller posts to one path and moving them is an expand/contract across a separately-shipped image — its five answers are declared as a named union instead of the open document they were. ([validated by `coverage.test.ts:52`](apps/lore-api/src/openapi/coverage.test.ts#L52), [`coverage.test.ts:92`](apps/lore-api/src/openapi/coverage.test.ts#L92); implemented by [`tokens.ts:98`](apps/lore-api/src/api/routes/tokens/tokens.ts#L98), [`dark-factory.ts:73`](apps/lore-api/src/api/routes/dark-factory/dark-factory.ts#L73))

- **FR13** *(added 2026-08-20)* A web-ui hand-mirror is removable exactly when the shape it mirrors is served by lore-api under a DECLARED contract. That splits the six mirrors and their drift guards into three groups, and the split is a fact about the serving side rather than a judgement about the mirror. **Structural, not debt:** `run-stream-types`, `assembly-line-definition` and `run-turn-types` mirror shapes the FLOOR serves, and the Floor generates no OpenAPI document at all — it carries no generator and no `zodResponse` call, so there is nothing for a generated type to come from. **Not a type at all:** `spec-status` and `dark-factory-resolve` mirror LOGIC — a status parser and a settings resolver — which no generated type can replace; they keep their parity tests, which is the right guard for a function. **Blocked on an open contract:** `run-graph` and `trace-types` are lore-api-served and would be removable today except that neither route declares a shape a client could read — `AssemblyRun.graph` is `z.custom<RunGraph>()` and `/trace/{kind}` serves eight kinds behind one `z.record(z.unknown())`. Aliasing to either would LOSE field names rather than gain safety, which is the same wall that stopped twenty-eight of thirty-five conversions in #1437. The unblock is to declare those two shapes, not to delete the mirrors.

- **FR14** *(added 2026-08-20)* A DECLARED response contract is HELD TO the answer, not just written down. `zodResponse` is documentation-only by design — validating a response at runtime lets a doc comment 500 a working endpoint — so nothing in the serving path can notice a declaration that has gone wrong. An open document could not BE wrong; a named union can be wrong silently, and a generated client narrows over it. So the multiplexed memory surface carries a contract test that drives all five actions for real and parses every answer through the published schema. It runs against BOTH backends — the file fallback under a throwaway `$HOME`, and a migrated Postgres in the integration job — because one endpoint served by two backends is a lie half the time if only one of them satisfies the contract. Writing it is what surfaced the three places the two disagreed: the pool path's one-version read omitted the `key` it was asked for, and the fallback's search named no `source` while its listing answered whole entries where the pool answered a projection. The fallback was moved onto the pool path's answer rather than the union widened to cover both. ([validated by `memory-contract.test.ts:34`](apps/lore-api/src/api/routes/memory/memory-contract.test.ts#L34), [`memory-contract.test.ts:45`](apps/lore-api/src/api/routes/memory/memory-contract.test.ts#L45), [`memory-contract.test.ts:56`](apps/lore-api/src/api/routes/memory/memory-contract.test.ts#L56), [`memory-contract.test.ts:67`](apps/lore-api/src/api/routes/memory/memory-contract.test.ts#L67), [`memory-contract.test.ts:74`](apps/lore-api/src/api/routes/memory/memory-contract.test.ts#L74), [`memory-contract.test.ts:85`](apps/lore-api/src/api/routes/memory/memory-contract.test.ts#L85), [`memory-contract.test.ts:94`](apps/lore-api/src/api/routes/memory/memory-contract.test.ts#L94), [`memory-contract.test.ts:112`](apps/lore-api/src/api/routes/memory/memory-contract.test.ts#L112), [`memory-contract.test.ts:81`](apps/lore-api/src/integration-tests/memory-contract.test.ts#L81), [`memory-contract.test.ts:98`](apps/lore-api/src/integration-tests/memory-contract.test.ts#L98), [`memory-contract.test.ts:105`](apps/lore-api/src/integration-tests/memory-contract.test.ts#L105), [`memory-contract.test.ts:112`](apps/lore-api/src/integration-tests/memory-contract.test.ts#L112), [`memory-contract.test.ts:119`](apps/lore-api/src/integration-tests/memory-contract.test.ts#L119), [`memory-contract.test.ts:125`](apps/lore-api/src/integration-tests/memory-contract.test.ts#L125), [`memory-contract.test.ts:132`](apps/lore-api/src/integration-tests/memory-contract.test.ts#L132))
- **FR15** *(added 2026-08-20)* Every `method: "*"` route DECLARES whether it serves verbs or refuses them. `WILDCARD_METHODS` names the verbs a wildcard means to serve and `METHOD_NOT_ALLOWED_FALLBACKS` names the paths whose wildcard exists only to answer 405; a wildcard in neither table fails the coverage guard. The path-count assertion cannot see this case: a wildcard that means to serve a real verb on a path concrete verbs ALREADY document adds no new path key, so the operation goes missing from the document in silence. On a new path the same omission surfaces as a missing path — this closes the half that does not. ([validated by `coverage.test.ts:74`](apps/lore-api/src/openapi/coverage.test.ts#L74); implemented by [`build-document.ts:145`](apps/lore-api/src/openapi/build-document.ts#L145))
