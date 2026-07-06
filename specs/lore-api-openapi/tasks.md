# Tasks: Generate an OpenAPI 3.1 document for lore-api

Derives an OpenAPI 3.1 document from the zod route schemas ADR-034 made
declarative, and serves it (JSON + Redoc). Each phase is **one commit**; the
`apps/lore-api` vitest suite + `tsc --noEmit` stay green after every phase.
Verification (SC-1) boots the server against Docker Postgres and lints the served
document.

Legend: `[P]` = parallelizable with siblings in the same phase.

## Phase 0 — Foundation (ADR + spec)

- [x] T001 Write `adrs/ADR-035-lore-api-openapi.md` (MADR, builds on ADR-034):
  context (declarative zod schemas now exist, no machine-readable surface),
  decision (walk the shared route array; `zod-to-json-schema` already in tree; lift
  domain zod where it exists / freeform where it doesn't; `x-required-scope` +
  `bearerAuth`; read-scoped JSON + inlined Redoc), consequences, alternatives
  (`@asteasolutions/zod-to-openapi`, hand-rolled skeleton, parallel registry,
  public spec). Write `specs/lore-api-openapi/{spec,tasks}.md`.

## Phase 1 — Schema reachability (least-invasive)

- [x] T002 `apps/lore-api/src/server/plugins/zod-validate.ts`: `zodValidate(schema)`
  stamps `fn.zodSchema = schema` (typed `ZodValidateFn<T>`); add `getZodSchema(fn)`
  returning the schema or `undefined`. Behavior otherwise unchanged. Extend
  `zod-validate.test.ts`: the returned fn still validates, and `getZodSchema`
  recovers the exact schema. (FR1)
- [x] T003 Hoist the `server.route([...])` array out of `build-server.ts` into an
  exported `routeList(getPool)`; `buildServer` registers `routeList(getPool)`. No
  route changes. Suite green (pure refactor). (FR2)

## Phase 2 — The generator

- [x] T004 Declare `zod-to-json-schema` in `apps/lore-api/package.json` dependencies
  (pin the lockfile-resolved `^3.25.1`). `apps/lore-api/src/openapi/domain-routes.ts`:
  the fork-3 sidecar — a table keyed by path listing, for each domain/`*` route, its
  verbs and either a lifted zod schema (import `AgentInputSchema`,
  `DarkFactorySettingsSchema`) or a `freeform` marker (features, tokens) + the
  webhook/excluded entries. (FR3, FR6, fork 3)
- [x] T005 `apps/lore-api/src/openapi/build-document.ts`: `buildOpenApiDocument(routes)`
  → OpenAPI 3.1 object. Per route: derive method(s) (expand `*` via the sidecar),
  convert hapi path params (`{p}`/`{p?}`/`{p*}`) to OpenAPI parameters with correct
  `required`, resolve scope from `options.plugins["bearer-scope"].scope`, resolve
  the rate bucket, convert the payload schema via `zodToJsonSchema` (covered routes)
  or the sidecar schema/freeform (domain routes), attach `x-required-scope` /
  `x-rate-limit-bucket` / shared error `$ref` responses. Assemble `info`, `servers`
  (from `LORE_API_URL` when set), `components.securitySchemes.bearerAuth`,
  `components.responses`. Exclude + log `/healthz`, `/dist/*` (FR7).
- [x] T006 `apps/lore-api/src/openapi/build-document.test.ts` (unit): covered route →
  `requestBody` with required fields/enums; memory union → `oneOf`; agents/dark-factory
  → lifted schema present; features/tokens → freeform `object`; `*` routes expand to
  their verbs; every `/api/*` route appears once; scope + bucket extensions present;
  `bearerAuth` sole scheme; webhooks `security: []`. (SC-2, SC-3, SC-5)

## Phase 3 — Serving surface

- [x] T007 `apps/lore-api/src/api/routes/openapi/openapi.ts`: `openApiJsonRoute(getPool)`
  (`GET /api/openapi.json`, `bearerScope("read")`) returns `buildOpenApiDocument(routeList(getPool))`;
  `docsRoute(getPool)` (`GET /api/docs`, `bearerScope("read")`) returns an HTML page
  that inlines the document and calls `Redoc.init`. Register both in `routeList`
  (so the doc self-describes). Guard against build-time recursion (build the doc
  from the route array, not by re-invoking the serving routes' handlers). (FR5)
- [x] T008 `apps/lore-api/src/api/routes/openapi/openapi.test.ts` (inject): `GET
  /api/openapi.json` with a read token → `200`, `openapi: "3.1.0"`, `paths` non-empty;
  missing token → `401`; a write-only... i.e. under-scoped token still `403` before
  the handler; `GET /api/docs` → `200 text/html` containing the inlined spec + Redoc
  script. (FR5, SC-5)

## Phase 4 — Drift guard

- [ ] T009 `apps/lore-api/src/openapi/coverage.test.ts`: for every route in
  `routeList` with a body-bearing method, assert it has a `zodValidate` payload
  schema OR a sidecar allowlist entry — a fixture route with neither fails; assert
  the `paths` count equals the `/api/*` route count and the doc is a structurally
  valid OpenAPI 3.1 object. (SC-2, SC-4)

## Phase 5 — Verification (SC-1)

- [ ] T010 `npm run build` (root) + `cd apps/lore-api && npx tsc --noEmit && npx
  vitest run`. Then boot standalone against Docker Postgres (`npm run db:up`;
  `LORE_DB_HOST=localhost … LORE_INGEST_TOKEN=lore-local-dev-token PORT=3001 node
  dist/index.js`), `curl -H "Authorization: Bearer lore-local-dev-token"
  localhost:3001/api/openapi.json > /tmp/openapi.json`, and validate with `npx
  @redocly/cli lint /tmp/openapi.json`. Record the result in the PR. (SC-1, SC-6)
