---
adr_number: 35
title: "Generate the lore-api OpenAPI 3.1 document from the zod route schemas"
status: draft
date: 2026-07-06
domains: [lore-api, http, validation, openapi, dx]
relates: "specs/lore-api-openapi/spec.md"
builds_on: "adrs/ADR-034-lore-api-request-validation.md"
---

# ADR-035: lore-api OpenAPI 3.1 document generated from zod route schemas

This ADR generates lore-api's OpenAPI 3.1 document by walking the same route array the server registers and converting each zod schema with the already-resolved zod-to-json-schema library, with a drift guard that fails the build if a body-bearing route lacks a schema.

## Context

ADR-034 moved every JSON API route's request validation into hapi's
`options.validate` via a shared zod adapter. Its own consequences named the payoff:
*"Declarative schemas are the substrate an OpenAPI document is generated from — this
unblocks that follow-on feature."* Until then, each route's contract was
re-derived by imperative checks inside the handler; there was nothing to generate a
document *from*. Now there is.

lore-api serves ~50 `/api/*` operations and has no machine-readable description of
that surface. Clients (the mcp-server proxy, the web UI, CI, new engineers) read
route source to learn the contract. The pieces needed to fix that are all present:

- Routes register in **one place** — `build-server.ts` `server.route([...])` — each
  carrying `method`, `path`, required scope (`options.plugins["bearer-scope"].scope`),
  and, where converted, its zod payload schema (`options.validate.payload`). ADR-033
  deliberately deleted the parallel URL→scope map, so the route array is already the
  single source of truth.
- The raw zod schema is currently hidden inside the `zodValidate(schema)` closure and
  not recoverable from the returned validation function.

Two forces constrain the design, both inherited from ADR-033/034: **fewest elements**
(they rejected joi and fastify to avoid new surface) and **no route forks** (the
route array must stay the one source; no shadow registry).

## Decision

**Generate the document by walking the same route array the server registers, and
convert each zod schema with the `zod-to-json-schema` library already resolved in
the repo lockfile.**

1. **Make the schema reachable without forking routes.** `zodValidate(schema)`
   stamps the raw schema onto the function it returns (`fn.zodSchema = schema`); a
   `getZodSchema(fn)` reader recovers it. The `server.route([...])` array is hoisted
   into a shared `routeList(getPool)` consumed by both `buildServer` and the
   generator. The generator reads exactly what the server runs — no parallel
   registry, no route-definition changes.

2. **`zod-to-json-schema`, not `@asteasolutions/zod-to-openapi`.** The former is
   **already in the tree** (`3.25.2`, top-level in `node_modules`, zod-v3-native,
   pulled transitively). OpenAPI 3.1's schema dialect is JSON Schema 2020-12, so its
   output embeds directly into each operation's `requestBody`. `@asteasolutions/
   zod-to-openapi` is absent and would add a fresh dependency subtree plus its own
   registry-registration model — a second projection of the route table. We own the
   OpenAPI envelope (paths, security, responses) regardless, because a schema
   converter knows nothing of hapi routes, scopes, or rate buckets. Adopting a new
   dependency to do work we must do anyway fails the fewest-elements axis ADR-033/034
   set.

3. **Partial coverage: lift domain zod where it exists, freeform where it doesn't.**
   Four routes keep domain validators (ADR-034 §5 kept transforming validators in
   handlers). `agents` and `dark-factory` validate through **exported zod schemas**
   (`AgentInputSchema`, `DarkFactorySettingsSchema`) — the generator references those
   for accurate bodies at zero new schema cost. `features` (`enforceFeatureInput`)
   and `tokens` (a TS interface) are hand-rolled — the generator emits a freeform
   `object` body and records them as uncovered. A single **domain-route sidecar**
   holds these exceptions and the concrete verbs for the two `method: "*"` routes
   (which hapi expresses as a wildcard the doc cannot). The drift guard cross-checks
   the sidecar so it cannot drift from the routes.

4. **Auth, scope, rate limits are modelled honestly.** One `bearerAuth` security
   scheme (`http`/`bearer`). Authed operations set `security: [{ bearerAuth: [] }]`;
   HMAC-verifying webhook operations set `security: []`. HTTP-bearer security has no
   first-class scope list (unlike oauth2), so per-route scope is a `x-required-scope`
   extension rather than a faked oauth2 flow; the rate bucket is `x-rate-limit-bucket`.
   Shared error responses (`400/401/403/413/429/503`, the uniform `{ error }`
   envelope) are `components.responses` referenced by operations.

5. **Request-focused document.** We have declarative schemas for request bodies and
   the error envelope, not for success bodies. Success responses are documented
   generically (`object`); `info.description` states this. The doc does not invent
   response shapes it cannot derive.

6. **Surface: read-scoped JSON + inlined Redoc.** `GET /api/openapi.json` (read
   scope, consistent with every other read route on this fully-authenticated
   backend) serves the document. `GET /api/docs` (read scope) serves a Redoc HTML
   page that **inlines** the document — a browser cannot attach a bearer to a second
   cross-origin fetch, so inlining keeps the page to a single read-scoped gate with
   no second request. Both serving routes live in `routeList`, so the document
   describes itself.

7. **Drift guard.** A test builds the document from `routeList(() => null)` and fails
   if a body-bearing route (`POST`/`PUT`/`DELETE`/`*`) has neither a `zodValidate`
   payload schema nor a sidecar allowlist entry, if any `/api/*` route is missing
   from `paths`, or if the output is not a structurally valid OpenAPI 3.1 object. An
   external linter validates the served document in verification.

## Consequences

**Positive**

- One machine-readable contract, generated from the route array — never hand-synced,
  never able to drift silently (the guard fails the build).
- Zero new dependency subtree: the converter was already resolved in the lockfile.
- The mcp-server proxy and web-UI clients can later be regenerated from the document
  instead of hand-maintained.
- Scope and rate-limit posture are visible per operation.

**Negative / costs**

- We hand-assemble the OpenAPI envelope (paths, security, responses) rather than
  delegating to a full generator library. This is deliberate — it is work a schema
  converter cannot do — but it is code we own and test.
- The document is request-focused: success-body schemas are generic until a later
  feature supplies a declarative source. Stated in `info.description` so it does not
  read as complete-but-wrong.
- The domain-route sidecar is a small second place that names the four
  domain-validated routes. It is bounded, guarded against drift, and exactly mirrors
  ADR-034's already-acknowledged residual — not a new parallel table for the whole
  surface.
- Read-scoping `/api/docs` means a raw browser cannot load it without a token
  (inherent to a fully-authenticated backend); it is reached via authenticating
  tooling/proxy. Chosen over a public spec for consistency with every other route.

**Neutral**

- Purely additive: two new read routes and a generator module. No existing route's
  path, method, scope, rate-limit budget, or validation changes.

## Alternatives considered

1. **`@asteasolutions/zod-to-openapi`.** The purpose-built zod→OpenAPI-3.1 library.
   Rejected on fewest-elements: it is absent (a new dependency subtree) and its
   registry model is a second projection of the route table, while we must own the
   envelope regardless. `zod-to-json-schema` is already in the tree and covers the
   only part a library genuinely helps with (schema conversion).

2. **A parallel route/schema registry** (`{path, method, scope, schema}[]`).
   Rejected: it re-introduces exactly the parallel URL→scope map ADR-033 deleted, and
   it would drift from the real routes. Stamping the schema onto the validation
   function keeps the route array the single source.

3. **Export each route schema and import them into the generator.** Rejected: the
   generator would still need to join schemas back to their path/method/scope — i.e.
   reconstruct the route array — so it is strictly more code than reading the array
   directly.

4. **A public (unauthenticated) spec at `/openapi.json`** (like `/healthz`,
   `/dist`). Rejected for the default: this backend authenticates every `/api/*`
   route; a world-readable endpoint map is inconsistent with that posture. Recorded
   as the alternative if external unauthenticated tooling ever needs it.

5. **Document response bodies too.** Deferred: there is no declarative source for
   success shapes (validation only covers requests). Inventing them by hand would be
   the un-generated, drift-prone artifact this feature exists to avoid.
