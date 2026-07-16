---
adr_number: 33
title: "Migrate lore-api from hand-rolled node:http to the hapi framework"
status: draft
date: 2026-07-02
domains: [lore-api, http, routing, auth, dx]
relates: "specs/hapi-migration/spec.md"
---

# ADR-033: Migrate lore-api to the hapi HTTP framework

This ADR migrates lore-api from a hand-rolled node:http server to the hapi framework via the strangler-fig pattern, making route resolution, bearer-scope auth, rate limiting, and the body cap first-class framework constructs while keeping the API shippable after every PR.

## Context

The remote REST backend `apps/lore-api` serves every `/api/*` route on a
**hand-rolled `node:http` server**. The transport is a bare `createServer`
(`server/http-server.ts`); dispatch is an ordered match-table in
`api/routes/index.ts` where ~30 routes are `{ match, handle }` pairs tested
top-to-bottom until one wins. Every handler carries the raw signature
`(req: IncomingMessage, res: ServerResponse, pool)` and writes its own response
through a `json(res, code, body)` helper.

That design has quietly accrued cost:

- **Route ordering is load-bearing and invisible.** Specific regex routes must
  precede broad prefixes (`/api/tasks/:id/timeline` before `/api/tasks`). A
  mis-ordered insert silently shadows a route with nothing to catch it.
- **Cross-cutting concerns are hand-wired and duplicated.** Bearer-scope auth,
  the sliding-window rate limiter, and the 1 MB body cap live as imperative
  blocks inside `handleApiRoute`, and the body cap is re-implemented a *second*
  time in `http.ts` (`readJsonBody`). Scope requirements live in a parallel
  URL→scope map (`auth.ts`) that must be hand-synced with the route table.
- **Handlers own plumbing they should not.** Each parses its own URL, reads its
  own body, sets its own headers, and stringifies its own JSON. Domain logic is
  buried under transport boilerplate.
- **The raw signature resists everything a framework gives for free**: typed
  path params, per-route validation, per-route auth scope, lifecycle extension
  points, structured logging, graceful shutdown.

There is already an in-repo precedent: **`apps/floor` runs on hapi**
(`@hapi/hapi ^21.4.9`, `@hapi/boom`) and traces every request via a single hapi
extension rather than per-handler plumbing (commit `4d6f1d3`,
`feat(floor): trace all HTTP requests via a hapi extension`). hapi is a proven,
maintained choice inside this monorepo — this migration aligns the two Node
HTTP servers on one framework rather than introducing a new one.

The constraint is **no flag day**. lore-api is a live shared backend; the API
must stay green, behaviorally identical, and shippable after **every single
PR** — no window where a route 404s mid-migration.

## Decision

Adopt **hapi (`@hapi/hapi`)** as the lore-api HTTP framework via the
**strangler-fig pattern**.

1. **hapi hosts the server from PR #1.** No request path is served by bare
   `node:http` after the first PR. A single `buildServer(getPool)` factory is
   the only place a server is constructed — used by both production boot
   (`http-server.ts` shrinks to `buildServer().start()`) and the integration
   tests.

2. **A catch-all route bridges to the legacy dispatcher** during migration.
   hapi exposes the underlying Node objects at `request.raw.req`/`request.raw.res`;
   a `method: "*", path: "/{any*}"` route with `auth: false` delegates anything
   not-yet-migrated to the existing `handleApiRoute(req, res, pool)` and returns
   `h.abandon` (the legacy handler already wrote the response). Native hapi
   routes win over `/{any*}` by specificity, so a migrated group takes over the
   instant its route is registered.

3. **Route groups migrate one small PR at a time**, sequenced cheapest-and-
   safest first (infra reads → repo reads → context → task reads → task writes →
   memory → ingest → repo writes → webhooks → admin/settings → trace/impact/
   features). Migrating a group **deletes** that group's rows from the legacy
   `API_ROUTES` table and its entries from the `getRequiredScope`/`SCOPE_OVERRIDES`
   maps **in the same PR** — no dead legacy routing is left behind.

4. **Cross-cutting concerns become first-class hapi constructs:**
   - **Auth** → a custom `bearer-scope` scheme wrapping the existing
     `validateClientToken`. It authenticates the bearer once and sets
     `credentials.scope` from `pipeline.api_tokens` (admin ⇒ all scopes); each
     route declares `options.auth.access.scope`. The legacy `LORE_INGEST_TOKEN`
     full-access fallback is preserved inside the scheme. Webhook routes keep
     their own HMAC verification and set `auth: false`.
   - **Rate limiting** → an `onPreAuth` server extension reusing the exact
     sliding-window bucket logic; `webhook`/`task`/`default` bucket selection
     moves into the ext.
   - **Body cap** → hapi route `payload: { maxBytes: 1_048_576 }`; the two
     manual caps are removed once no legacy route depends on them.

5. **Validation stays on zod** — already a dependency, already used across the
   codebase. hapi's native validator is joi; we do **not** introduce joi
   (fewest elements). Route validation, where added, calls the existing zod
   schemas.

6. **Teardown removes the scaffolding.** When the final group migrates, the
   catch-all, `handleApiRoute`, `API_ROUTES`, the `getRequiredScope` map, and the
   manual rate-limit/body gates are deleted. No `node:http` `createServer`
   remains in lore-api application code; `@hapi/hapi` is a declared dependency.

This is a framework swap, not an API redesign — no route's path, contract, auth
scope, or rate-limit budget changes.

## Consequences

**Positive**

- Route shadowing becomes a framework concern, not a code-review vigilance
  tax: hapi's router resolves by specificity and rejects conflicting
  registrations instead of silently ordering them.
- Auth scope, rate limiting, and the body cap live once, declaratively, on the
  request lifecycle instead of duplicated across `index.ts`/`http.ts`/`auth.ts`.
  The parallel URL→scope map disappears — scope is co-located on the route.
- Handlers return values; hapi serializes and sets headers. Domain logic stops
  carrying transport boilerplate.
- Per-route typed params, per-route validation hooks, lifecycle extensions,
  structured logging, and graceful shutdown come from the framework.
- lore-api and floor run the **same** HTTP framework — one mental model, shared
  patterns (e.g. the trace extension), one set of versions to maintain.

**Negative / costs**

- New runtime dependency (`@hapi/hapi`, `@hapi/boom`, `@types/hapi__hapi`),
  though already vetted and pinned by floor.
- The strangler seam is a temporary wart: the `/{any*}` catch-all + `h.abandon`
  bridge and the dual routing world exist for the length of the migration
  (~12 PRs). Discipline is required to keep deleting legacy rows per group so the
  seam actually shrinks.
- Behavioral parity must be proven **per PR** — same paths, methods, status
  codes, bodies, auth outcomes (401/403), and rate-limit behavior
  (429 + `Retry-After: 60`). Each group carries its contract tests migrated
  alongside it. This is deliberate test burden traded for revertability.

**Neutral**

- The REST contract is unchanged. This is structural, not behavioral —
  identical to how ADR-032's split was contract-preserving.

## Alternatives considered

1. **Keep `node:http`, add a lightweight router (`find-my-way`, etc.).**
   Rejected: a router fixes only the ordering problem. It gives no auth
   strategies, no request lifecycle extension points, no per-route validation,
   and no graceful shutdown — and it would be a *third* HTTP style in the repo
   alongside floor's hapi and the legacy dispatcher.

2. **Express.** Rejected: heavier, untyped middleware model with no first-class
   auth-scope or route-validation story, and choosing it would leave the repo
   running two different frameworks (floor on hapi, lore-api on Express) for no
   gain.

3. **Fastify.** A credible modern choice with good typing and schema validation.
   Rejected on the **fewest-elements-at-org-level** axis: floor already proved
   hapi here, so hapi means one framework across both Node servers. Introducing
   Fastify would optimize lore-api in isolation while fragmenting the monorepo.

4. **Big-bang rewrite (swap the whole server in one PR).** Rejected: a flag day
   on a live shared backend. Un-revertable, all-or-nothing, and it violates the
   hard requirement that the API stay green and shippable after every PR. The
   strangler-fig keeps each step independently revertable with no outage.
