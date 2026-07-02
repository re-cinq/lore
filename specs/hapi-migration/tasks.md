# Tasks: Migrate lore-api to the hapi HTTP Framework

**Status: Draft — not started.** Strangler-fig migration (ADR-033): hapi hosts
the server from Phase 1 (PR #1) via a `buildServer` factory + a catch-all bridge
to the legacy dispatcher; route groups move to native hapi routes one PR at a
time (Phases 2–12); the catch-all and legacy dispatcher are deleted at teardown
(Phase 13). Every PR leaves the full lore-api suite green and the API
behaviorally unchanged.

Legend: `[P]` = parallelizable with siblings in the same phase. Each group phase
(2–12) is **one PR**: register the native routes, delete the group's legacy rows,
migrate the group's contract tests — all together.

## Phase 0 — Decision recorded

- [x] T001 Write `adrs/ADR-033-lore-api-hapi.md` (MADR): context (hand-rolled
  `node:http`, invisible route ordering, duplicated cross-cutting concerns),
  decision (hapi via strangler-fig, `buildServer` factory, `bearer-scope` scheme,
  `onPreAuth` rate-limit ext, `payload.maxBytes` cap, keep zod not joi),
  consequences, alternatives (find-my-way / Express / Fastify / big-bang). Cite
  the floor hapi precedent.
- [x] T002 Fix the spec's ADR reference (`ADR-032` → `ADR-033`; ADR-032 is
  `split-local-remote-api`) and commit spec + ADR + tasks.

## Phase 1 — Strangler seam: hapi hosts 100% of traffic (PR #1) (FR1, FR3)

> **DONE.** hapi is in front of the whole API via `buildServer`; every route is
> still served by the legacy dispatcher through one catch-all bridge. Zero
> behavioral change — full suite green (375 tests). **Scope note:** the seam is
> deliberately minimal. The `bearer-scope` and `rate-limit` plugins (former
> T006/T007) are **inert until a native route needs them**, so each moves to its
> first consumer: `rate-limit` lands in Phase 2 (with `/dist`, the first native
> rate-limited route), `bearer-scope` in Phase 3 (with repos-read, the first
> authed group). Building them dormant now is speculative, and the rate-limit ext
> would risk double-counting against the legacy limiter during the bridge window.
> The body cap (former T008) is a
> one-liner folded into `build-server.ts` (server-level `payload.maxBytes`), no
> separate file — matching floor's own precedent.

- [x] T003 Add deps to `apps/lore-api/package.json`: `@hapi/hapi ^21.4.9`,
  `@hapi/boom ^10.0.1`, `@types/hapi__hapi ^20.0.13` — pinned to floor's versions.
- [x] T004 `apps/lore-api/src/server/build-server.ts`: `buildServer(getPool, port)`
  → hapi `Server`. Server-level `payload.maxBytes = 1 MB` is the native-route
  body-cap default (former T008, inlined). **One** construction site, shared by
  prod boot and the tests.
- [x] T005 Catch-all bridge in `build-server.ts`: `method: "*", path: "/{any*}"`,
  `{ auth: false, payload: { parse: false } }`. A `Readable` shim carries the
  buffered body + raw url (with query)/method/headers to `handleApiRoute`;
  preserves the old 1 MB Content-Length `413` byte-for-byte; traces via
  `traceHttp`; writes `request.raw.res` and returns `h.abandon` (or 404 when the
  dispatcher declines). Legacy rate-limit + bearer auth stay owned by the
  dispatcher for un-migrated routes.
- [x] T009 `http-server.ts` reduced to a thin boot: `buildServer(getPool, PORT)`
  → `.start()` + SIGTERM graceful `stop()`. `src/index.ts` unchanged
  (`startHttpServer(getPool)`). No bare `createServer` in the boot path.
- [x] T010 Tests: `src/server/build-server.test.ts` drives the hapi server via
  `inject` (healthz 200 through the bridge, unknown → 404, protected-no-token →
  401, POST Content-Length → 413, POST body reaches the handler via the shim).
  Ported `integration-tests/proxy.test.ts` from raw `createServer` to
  `buildServer` + `start()`/`stop()` (real-socket body round-trip, DB-gated).
  (SC-2, SC-5)

## Phase 2 — Infra group + rate-limit ext (PR)

> **DONE.** `/healthz` and `/dist/lore-code-trace/*` are native hapi routes.
> `/dist` is the first native **rate-limited** route (default bucket), so the
> rate-limit ext lands here (moved from Phase 3); `/healthz` stays exempt from
> both auth and rate limiting. Full suite green (377 tests).

- [x] T011 Native hapi routes: `healthzRoute(getPool)` (`routes/healthz/`) and
  `distRoute()` (`routes/dist/`), both `auth: false`, returning values (hapi
  serializes + sets headers). Registered in `build-server.ts`; rows deleted from
  `API_ROUTES`. Tests migrated to `buildServer(...).inject`
  (`healthz.test.ts`, `dist.test.ts`; `parseDistArtifact` unit tests kept); the
  stale `handleHealthz` mock/comment removed from `dispatch.test.ts`. (SC-5)
- [x] T011b `server/plugins/rate-limit.ts`: `onPreAuth` ext reusing the exact
  `rateLimit()`/`RateBucket` from `routes/auth.ts` (single source). Skips the
  catch-all bridge **and** `/healthz`, so each request is counted once (native
  via the ext, bridged via the legacy dispatcher — never both). `429` +
  `Retry-After: 60` + `{ error: "rate limit exceeded" }` match the legacy gate.
  `rate-limit.test.ts` proves `/dist` trips at the 201st, a bridged route is not
  double-counted, and `/healthz` is exempt. (SC-4)

## Phase 3 — Repos (read) group — first authed native group (PR)

> **DONE.** The `bearer-scope` plugin lands here (moved from Phase 1): the first
> native routes that need bearer auth. Rate limiting is already live (Phase 2)
> and covers these routes via the ext (default bucket). Full suite green (385).

- [x] T012a `server/plugins/bearer-scope.ts`: hapi auth scheme + strategy. The
  scheme authenticates the bearer once via the new `resolveTokenScopes()` and
  sets `credentials.scope`; routes opt in with `bearerScope("read")` (sets
  `options.auth` + a per-route required-scope). The scheme itself enforces the
  scope and throws so the bodies match the legacy gate byte-for-byte — MISSING
  bearer → 401 `{error:"unauthorized"}`; any present-but-invalid/under-scoped
  token → 403 `{error:"insufficient scope"}` (Boom `output.payload` overridden).
  `resolveTokenScopes()` added to `routes/auth.ts` (returns the token's scopes or
  null; legacy `LORE_INGEST_TOKEN` ⇒ all scopes, no DB hit); `validateClientToken`
  refactored to delegate to it (unchanged behavior, kept for the legacy
  dispatcher). `bearer-scope.test.ts` proves the full auth matrix via throwaway
  routes. (SC-3)
- [x] T012 Native routes `repoStatusRoute`/`reposRoute`/`prStatusRoute`
  (`routes/repos/`, `bearerScope("read")`), registered in `build-server.ts`.
  Deleted the three legacy rows + the `/api/repo-status` `ROUTE_SCOPES` entry.
  `repo-status.test.ts` migrated to `inject`. (FR4, FR5, SC-3)

> **Debt (observability, not behavior):** native routes do not yet emit a
> per-request OTel span — the bridge still calls `traceHttp` for legacy routes,
> but native handlers return values and bypass it. Floor already has the pattern
> (`registerRequestTracing`, onRequest/onPreResponse). Add a tracing ext for
> native routes (skipping the `h.abandon` bridge to avoid double-tracing) before
> teardown removes the bridge's manual `traceHttp`. Tracked for a later phase.

## Phase 4 — Context + graph group (PR)

> **DONE.** Mechanical now that the machinery is in place. Full suite green (385).

- [x] T013 Native routes `contextRoute`/`graphRoute` (`routes/context/`,
  `routes/graph/`, `bearerScope("read")`), registered in `build-server.ts`.
  `request.query` replaces the manual `URL` parsing; the exact `assembleContext`
  arg order (incl. `resolveCrossRepo` + Dgraph fail-soft null) and the `graph`
  503/500 paths are preserved. Deleted the two legacy rows + their `ROUTE_SCOPES`
  entries. `context.test.ts` / `graph.test.ts` migrated to `inject` (collaborator
  mocks + call-arg assertions intact). (FR5, SC-3)

## Phase 5 — Tasks (read) group (PR)

> **DONE.** Six native routes; hapi's radix tree replaces the load-bearing regex
> ordering. Full suite green (384 — one net drop, see the dropped test below).

- [x] T014 Native routes `getTaskRoute`/`listTasksRoute`/`timelineRoute`/
  `taskByPrRoute`/`taskLogsGetRoute`/`jobRunLogsRoute` (`routes/tasks/`), all
  returning values. **Typed path params** replace the regex table:
  `/api/task/{id}`, `/api/tasks/{id}/timeline`,
  `/api/tasks/by-pr/{owner}/{repo}/{number}` — hapi resolves specificity
  structurally, so the "specific regex before broad prefix" hand-ordering is
  gone. Registered in `build-server.ts`; six legacy rows deleted.
- [x] Scopes preserved exactly: task/list/timeline/by-pr/job-run-logs = `read`;
  **`GET /api/task-logs` = `task`**, NOT write — the legacy `getRequiredScope`
  matches `/api/task` (first-match-wins, `startsWith`) before the dead
  `/api/task-logs`→`write` entry, so `task` is the real required scope. Deleted
  the migrated `ROUTE_SCOPES` entries (`/api/tasks`, `/api/task/`,
  `/api/job-run-logs`) + the dead `/api/task-logs`→`write`. Kept `/api/task`→`task`
  (POST `/api/task` + POST `/api/task-logs`, both still bridged — Phase 6).
- [x] `task-logs.ts` keeps the raw `handleTaskLogs` (POST, bridged) alongside the
  native GET route. Tests migrated to `inject`; `task-logs.test.ts` POST block
  still drives the bridge. **Dropped** the timeline "stricter handler regex" 404
  test: `?` in the malformed path made it query-string under hapi, so that
  internal defensive branch (and its `TIMELINE_RE`) is now unreachable — removed
  as dead code. (FR5, SC-3)

## Phase 6 — Tasks (write) group (PR)

> **DONE.** First write group. Full suite green (385).

- [x] T015 Native `taskPostRoute` (`POST /api/task`) + `taskLogsPostRoute`
  (`POST /api/task-logs`), both `bearerScope("task")` + `payload: { parse: false }`
  so the handler JSON-parses the raw body itself (new `server/raw-body.ts`) —
  matching the legacy `readBody`+`JSON.parse`, which **500s on invalid JSON**
  (hapi's own parser would 400; the proxy sends `application/json`, so this
  matters). Registered in `build-server.ts`; both legacy POST rows deleted, and
  the last `/api/task`→`task` `ROUTE_SCOPES` entry removed. Rate-limit parity via
  the ext: `/api/task` → `task` bucket, `/api/task-logs` → `default`.
- [x] Tests migrated to `inject`: `task-post.test.ts` (incl. invalid-JSON 500),
  `task-logs.test.ts` POST block off the bridge. `rate-limit.test.ts` gains the
  **`task`-bucket 61st-request 429** assertion (SC-4). The `build-server.test.ts`
  bridge tests were repointed to stably-bridged paths (`/api/nope` for
  404/401/413; `/api/memory {action:"bogus"}` for the body-shim proof) since
  `/api/task` is now native. (FR5, SC-3, SC-4)

> **Intentional body change (spec-sanctioned):** an oversized (>1 MB) POST to a
> **native** route now returns hapi's payload 413 body (`{statusCode,error,message}`)
> rather than the bridge's legacy `{error:"request body too large"}`. This is the
> spec's "body cap the hapi way" (`payload.maxBytes`) end state; the status (413)
> is unchanged and the bridge keeps the legacy body for still-bridged routes.

## Phase 7 — Memory group (PR)

> **DONE.** Pure write-route pattern. Full suite green (385).

- [x] T016 Native `memoryRoute`/`episodeRoute`/`sessionSummaryRoute`
  (`routes/memory/`, `bearerScope("write")` + `payload: { parse: false }` +
  `rawBody`). Preserved: the memory action switch (write/read/search/delete/list
  + unknown→400), `episode`'s `pool!` (no guard → 500 on null pool via the throw),
  `session-summary`'s ordering (short-summary skip before the 503 pool guard), and
  the fire-and-forget `extractFactsFromEpisode`/`extractAndUpdateGraph` `.catch`.
  Deleted the three legacy rows + `ROUTE_SCOPES` entries. Tests migrated to
  `inject` (auth 401/403 + invalid-JSON 500 kept). The `build-server.test.ts`
  body-shim test moved off `/api/memory` (now native) to `POST /api/onboard`
  (still bridged; delivered body → 400, empty → 500). (FR5, SC-3)

## Phase 8 — Ingest group (PR)

> **DONE.** Full suite green (384 — one net drop, an obsolete scope test removed).

- [x] T017 Native `ingestRoute` (`POST /api/ingest`) + `ingestGraphRoute`
  (`POST /api/repos/{owner}/{repo}/ingest-graph`), `bearerScope("write")` +
  `parse:false`. `ingest-graph` uses typed `{owner}/{repo}` params (the
  `repoFromReposUrl` null branch is now dead — dropped) and preserves the
  empty-body→`{}` behavior of the old `readJsonBody` (`raw ? JSON.parse(raw) :
  {}`). Both fire their fire-and-forget triggers (`triggerAgentSpecCoverageValidate`
  / `triggerAgentSpecTrace`) **before** the `return` — observably identical since
  they never touch the response. Deleted the two legacy rows, the `/api/ingest`
  `ROUTE_SCOPES` entry, **and the `ingest-graph` `SCOPE_OVERRIDE`**. Removed the
  now-obsolete `auth.test.ts` `getRequiredScope("…/ingest-graph")` assertion (the
  route's write scope is enforced declaratively via `bearerScope` now). (FR5, SC-3)

## Phase 9 — Repos (write) group (PR)

- [ ] T018 Native route for `POST /api/onboard` (`routes/repos/`). `write` scope.
  Delete legacy row + scope entry. Migrate tests. (FR5, SC-3)

## Phase 10 — Webhooks group (PR)

- [ ] T019 Native routes for `/api/webhook/slack`, `/api/webhook/incident`,
  `/api/repos/:o/:r/webhook{,/ensure,/secret}` (`routes/webhooks/`).
  `auth: false` — HMAC verification stays route-local; `webhook` rate-limit
  bucket. Delete legacy rows. Migrate tests incl. the `webhook`-bucket 429
  threshold + HMAC-reject cases. (FR4, SC-3, SC-4)

## Phase 11 — Admin / settings group (PR)

- [ ] T020 Native routes for `/api/tokens`,
  `/api/repos/:o/:r/settings/dark-factory`, `/api/repos/:o/:r/agent-definitions`
  (`routes/tokens/`, `routes/dark-factory/`, `routes/agent-definitions/`).
  `admin` scope; preserve the two-key authZ on privileged dark-factory fields.
  Delete legacy rows + scope entries. Migrate tests. (FR5, SC-3)

## Phase 12 — Trace + impact + features group (PR)

- [ ] T021 Native routes for `/api/repos/:o/:r/trace/*`, `/api/trace/specs`,
  `/api/repos/:o/:r/impact`, `/api/repos/:o/:r/features/*` (`routes/trace/`,
  `routes/impact/`). Correct scopes per current map. Delete legacy rows + scope
  entries. Migrate tests. This empties `API_ROUTES`. (FR5, SC-3)

## Phase 13 — Teardown (PR) (FR6)

- [ ] T022 Delete the catch-all `/{any*}` bridge from `build-server.ts`,
  `handleApiRoute` + the `API_ROUTES` table + the manual gates in
  `routes/index.ts`, the `getRequiredScope`/`SCOPE_OVERRIDES` maps in
  `routes/auth.ts`, and the second body cap in `routes/http.ts`. No `node:http`
  `createServer` remains in application code. (SC-1)

## Phase 14 — Verify

- [ ] T023 Full green: `apps/lore-api` builds + typechecks + tests; integration
  suite (`proxy`/`pipeline`/`webhook`) drives the hapi server via `buildServer`
  (SC-2); auth matrix preserved for every route — 401 missing, 403 under-scoped,
  `LORE_INGEST_TOKEN` full (SC-3); rate-limit thresholds + `Retry-After: 60`
  intact (SC-4); `grep -r "createServer" apps/lore-api/src` clean outside tests
  and `@hapi/hapi` declared (SC-1); each migration PR was independently revertable
  with no mid-migration 404s (SC-5).
