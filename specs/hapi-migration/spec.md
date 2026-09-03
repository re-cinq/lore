# Feature Specification: Migrate lore-api to the hapi HTTP Framework

| Field    | Value                                                              |
|----------|-------------------------------------------------------------------|
| Feature  | Replace the hand-rolled `node:http` router in `apps/lore-api` with hapi |
| Status   | In Progress                                                          |
| Created  | 2026-07-01                                                        |
| Owner    | Platform Engineering                                             |
| ADR      | [ADR-033](../../adrs/ADR-033-lore-api-hapi.md)                     |

This spec replaces lore-api's hand-rolled `node:http` router and its order-sensitive match-table with the hapi framework, turning routing, bearer-scope auth, rate limiting, and the body-size cap into declarative per-route configuration rather than duplicated imperative plumbing buried inside each handler.

## Problem Statement

The remote REST backend [`apps/lore-api`](../../apps/lore-api/) serves every
`/api/*` route on a **hand-rolled `node:http` server**. The transport is a bare
[`createServer`](../../apps/lore-api/src/server/http-server.ts); dispatch is an
ordered match-table in
[`api/routes/index.ts`](../../apps/lore-api/src/api/routes/index.ts) where each
of ~30 routes is a `{ match, handle }` pair tested top-to-bottom until one wins.
Every handler carries the raw signature `(req: IncomingMessage, res:
ServerResponse, pool)` and writes its own response through a `json(res, code,
body)` helper.

That design has quietly accrued costs:

- **Ordering is load-bearing and invisible.** Specific regex routes must precede
  broad prefixes (`/api/tasks/:id/timeline` before `/api/tasks`). A
  mis-ordered insert silently shadows a route. There is no framework to catch it.
- **Cross-cutting concerns are hand-wired and duplicated.** Bearer-scope auth,
  the sliding-window rate limiter, and the 1 MB body cap live as imperative
  blocks inside [`handleApiRoute`](https://github.com/re-cinq/lore/blob/85d151c9b39efa0f8d701a659638284daa6c946a/apps/lore-api/src/api/routes/index.ts#L102)
  and are partly re-implemented in
  [`http.ts`](https://github.com/re-cinq/lore/blob/85d151c9b39efa0f8d701a659638284daa6c946a/apps/lore-api/src/api/routes/http.ts) (`readJsonBody` caps
  the body a *second* time). Scope requirements live in a parallel URL→scope map
  ([`auth.ts`](https://github.com/re-cinq/lore/blob/85d151c9b39efa0f8d701a659638284daa6c946a/apps/lore-api/src/api/routes/auth.ts)) that must be kept in
  lockstep with the route table by hand.
- **Handlers own plumbing they should not.** Each one parses its own URL, reads
  its own body, sets its own headers, and stringifies its own JSON. The domain
  logic is buried under transport boilerplate.
- **The raw signature resists everything a framework gives for free**: typed path
  params, per-route validation, per-route auth scope, lifecycle extension points,
  structured logging, graceful shutdown.

We want hapi's declarative routing, first-class auth strategies, request
lifecycle extensions, and per-route validation — **without a flag day**. The
API must stay green and shippable after every single PR.

- The server drains and THEN flushes telemetry on `SIGTERM`. It used to only call `server.stop()`, so every rollout discarded the last span and metric batch — the telemetry from the final minute of a pod that was, by definition, being replaced. Both steps are best-effort and independent: a server that will not stop is exactly when the last batch is most worth having, and a failed export (an unauthed environment has no project id) must not turn a clean shutdown into a SIGKILL. The sequence is a named function rather than an inline handler so it is testable without raising a real signal at the test runner. ([validated by stops the server, then flushes telemetry](apps/lore-api/src/server/http-server.test.ts#L5), [`http-server.test.ts:18`](apps/lore-api/src/server/http-server.test.ts#L18), [`http-server.test.ts:31`](apps/lore-api/src/server/http-server.test.ts#L31))

## Solution

Adopt [hapi](https://hapi.dev) as the lore-api HTTP framework via the
**strangler-fig pattern**: hapi hosts the server from PR #1, a catch-all route
delegates everything not-yet-migrated to the existing dispatcher, and route
groups move to native hapi routes one small PR at a time. When the last group
moves, the catch-all and the legacy dispatcher are deleted.

### The strangler seam

hapi exposes the underlying Node objects on every request at `request.raw.req`
and `request.raw.res`. A single catch-all route bridges to the old world:

```ts
server.route({
  method: "*",
  path: "/{any*}",
  options: { auth: false },            // legacy handler does its own gating
  handler: async (request, h) => {
    const handled = await handleApiRoute(request.raw.req, request.raw.res, getPool());
    if (!handled) return h.response().code(404);
    return h.abandon;                   // handler already wrote request.raw.res
  },
});
```

Native hapi routes win over `/{any*}` by specificity, so a migrated group takes
over the instant its route is registered — and its entry in the legacy
`API_ROUTES` table becomes dead code we delete in the **same** PR.

### Target topology (end state)

```
apps/lore-api/src/
  server/
    build-server.ts     # NEW. buildServer(getPool) -> hapi Server.
                        #   registers native routes + (during migration) the
                        #   catch-all bridge. ONE construction site, shared by
                        #   prod boot AND the integration tests.
    http-server.ts      # startHttpServer() -> buildServer().start(). Thin.
    plugins/
      bearer-scope.ts   # hapi auth scheme/strategy: validates the token, sets
                        #   credentials.scope from pipeline.api_tokens.
      rate-limit.ts     # onPreAuth ext: the sliding-window buckets.
      body-cap.ts       # payload.maxBytes config (replaces the manual 1 MB cap).
  api/routes/
    <group>/route.ts    # native hapi RouteOptions[] per group (repos, tasks,
                        #   memory, context, ...). Handlers return values;
                        #   hapi serializes + sets headers.
```

`handleApiRoute`, the `API_ROUTES` match-table, the `getRequiredScope` map, and
the manual gates in `index.ts`/`http.ts` all shrink per PR and are **deleted**
when the final group migrates.

### Migration order (one route group per PR)

Groups are sequenced cheapest-and-safest first, so the pattern is proven on
low-risk reads before touching auth-sensitive writes:

1. **Infra** — `/healthz`, `/dist/lore-code-trace/*` (no auth, no DB).
2. **Repos (read)** — `/api/repo-status`, `/api/repos`, `/api/pr-status`.
3. **Context + graph** — `/api/context`, `/api/graph`.
4. **Tasks (read)** — `/api/task/:id`, `/api/tasks`, `/api/tasks/:id/timeline`,
   `/api/tasks/by-pr/*`, `/api/task-logs` (GET), `/api/job-run-logs`.
5. **Tasks (write)** — `POST /api/task`, `POST /api/task-logs`.
6. **Memory** — `POST /api/memory`, `/api/episode`, `/api/session-summary`.
7. **Ingest** — `POST /api/ingest`, `/api/repos/:o/:r/ingest-graph`.
8. **Repos (write)** — `POST /api/onboard`.
9. **Webhooks** — `/api/webhook/slack`, `/api/webhook/incident`,
   `/api/repos/:o/:r/webhook{,/ensure,/secret}` (HMAC auth stays route-local).
10. **Admin/settings** — `/api/tokens`, `/api/repos/:o/:r/settings/dark-factory`,
    `/api/repos/:o/:r/agent-definitions`.
11. **Trace + impact + features** — `/api/repos/:o/:r/trace/*`,
    `/api/trace/specs`, `/api/repos/:o/:r/impact`, `/api/repos/:o/:r/features/*`.
12. **Teardown** — delete the catch-all, `handleApiRoute`, `API_ROUTES`, the
    manual gates, and the `getRequiredScope` map. lore-api is pure hapi.

### Cross-cutting concerns, done the hapi way

- **Auth** → a custom `bearer-scope` scheme wrapping the existing
  `validateClientToken`. It authenticates the bearer once, sets
  `credentials.scope` to the token's scopes (admin ⇒ all), and each route
  declares `options.auth.access.scope`. The legacy `LORE_INGEST_TOKEN` full-access
  fallback is preserved inside the scheme: it resolves to all scopes without a DB
  hit, a client token is looked up by sha256 hash, and resolution returns `null`
  when the pool is null, no active row matches, or the lookup throws; an `admin`
  token satisfies any required scope while a token lacking it is denied. ([validated by `auth.test.ts:43`](apps/lore-api/src/api/routes/auth.test.ts#L43), [validated by `auth.test.ts:52`](apps/lore-api/src/api/routes/auth.test.ts#L52), [validated by `auth.test.ts:70`](apps/lore-api/src/api/routes/auth.test.ts#L70), [validated by `auth.test.ts:77`](apps/lore-api/src/api/routes/auth.test.ts#L77), [validated by `auth.test.ts:94`](apps/lore-api/src/api/routes/auth.test.ts#L94), [validated by `auth.test.ts:101`](apps/lore-api/src/api/routes/auth.test.ts#L101), [validated by `auth.test.ts:115`](apps/lore-api/src/api/routes/auth.test.ts#L115))
- **Rate limiting** → an `onPreAuth` server extension reusing the exact bucket
  logic; the `webhook`/`task`/`default` bucket selection moves into the ext.
- **Body cap** → hapi route `payload: { maxBytes: 1_048_576 }`; the two manual
  caps are removed once no legacy route depends on them.
- **Validation** → keep **zod** (already a dependency, already used across the
  codebase). Do **not** introduce joi — fewest elements.

## Functional Requirements

- **FR1** hapi (`@hapi/hapi`) serves `100%` of lore-api traffic from PR #1
  onward; no request path is served by bare `node:http` after the first PR.
- **FR2** Every merged PR leaves the full lore-api test suite green and the API
  behaviorally unchanged: same paths, methods, status codes, response bodies,
  auth outcomes, and rate-limit behavior.
- **FR3** A single `buildServer(getPool)` factory is the only place a server is
  constructed. Production boot and the integration tests both use it.
- **FR4** Native routes are guarded by the `bearer-scope` auth strategy with the
  same required scope the route has today; webhook routes keep their own HMAC
  verification and set `auth: false`. ([validated by `bearer-scope.test.ts:76`](apps/lore-api/src/server/plugins/bearer-scope.test.ts#L76))
- **FR5** Migrating a group deletes that group's rows from the legacy
  `API_ROUTES` table and its entries from the `getRequiredScope`/`SCOPE_OVERRIDES`
  maps in the same PR — no dead legacy routing is left behind.
- **FR6** At teardown, `handleApiRoute`, `API_ROUTES`, the manual rate-limit/body
  gates, and `getRequiredScope` are removed entirely; no `node:http`
  `createServer` remains in lore-api application code.

## Success Criteria

- **SC-1** `grep -r "createServer" apps/lore-api/src` returns nothing outside
  test archaeology after teardown; `@hapi/hapi` is a declared dependency.
- **SC-2** The integration suite (`proxy`/`pipeline`/`webhook`) passes driving
  the **hapi** server via `buildServer`, unchanged in intent.
- **SC-3** Auth matrix preserved: for every route, an under-scoped token still
  gets `403`, a missing token `401`, and `LORE_INGEST_TOKEN` full access — proven
  by tests migrated alongside each group. ([validated by `bearer-scope.test.ts:45`](apps/lore-api/src/server/plugins/bearer-scope.test.ts#L45))
- **SC-4** Rate limiting still returns `429` + `Retry-After: 60` at the same
  per-bucket thresholds (webhook 30, task 60, default 200 per minute); a bucket
  allows requests up to its limit then blocks, and admits them again once the 60s
  window slides past. ([validated by `rate-limit.test.ts:42`](apps/lore-api/src/server/plugins/rate-limit.test.ts#L42), [validated by `auth.test.ts:17`](apps/lore-api/src/api/routes/auth.test.ts#L17), [validated by `auth.test.ts:24`](apps/lore-api/src/api/routes/auth.test.ts#L24))
- **SC-5** Each PR in the migration is independently revertable and was merged
  without an API outage (no route 404s introduced mid-migration).

## Out of Scope

- Rewriting the MCP adapter (`apps/mcp-server`) or the Floor server
  (`apps/floor`) — this feature touches **lore-api only**.
- Swapping zod for joi, or adding OpenAPI/Swagger generation (possible future
  work once routes are declarative; not part of this migration).
- Changing any route's path, contract, auth scope, or rate-limit budget. This is
  a framework swap, not an API redesign.
