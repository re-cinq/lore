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
> T006/T007) are **inert until a native route needs them**, so they move to
> Phase 3 (the first authed + rate-limited group) — building them dormant now is
> speculative, and the rate-limit ext would risk double-counting against the
> legacy limiter during the bridge window. The body cap (former T008) is a
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

## Phase 2 — Infra group (no auth, no DB) (PR)

- [ ] T011 Native hapi routes for `/healthz` and `/dist/lore-code-trace/*`
  (`routes/healthz/`, `routes/dist/`); `auth: false`. Delete their rows from
  `API_ROUTES` in `routes/index.ts`. Migrate their tests. (SC-5)

## Phase 3 — Repos (read) group — first authed + rate-limited native group (PR)

> This is where the two cross-cutting plugins land (moved from Phase 1): the
> first native routes that need bearer auth **and** rate limiting.

- [ ] T012a `apps/lore-api/src/server/plugins/bearer-scope.ts`: hapi auth
  scheme/strategy wrapping `validateClientToken`. Authenticates the bearer once,
  sets `credentials.scope` from `pipeline.api_tokens` (admin ⇒ all scopes);
  preserves the `LORE_INGEST_TOKEN` full-access fallback. Registered as a named,
  non-default strategy (the catch-all keeps `auth: false`); native routes opt in
  via `options.auth`. Add `resolveTokenScopes()` to `routes/auth.ts` (additive;
  leaves `getRequiredScope`/`validateClientToken` intact for the legacy path).
  Reconcile the 401/403 response bodies to match the legacy `{ error }` shape.
  Unit-test the scheme via a throwaway route.
- [ ] T012b `apps/lore-api/src/server/plugins/rate-limit.ts`: `onPreAuth` server
  ext reusing the exact `rateLimit()` + `RateBucket` from `routes/auth.ts`
  (single source → identical thresholds). Selects `webhook`/`task`/`default` by
  path; **skips the catch-all route and `/healthz`** so each request is counted
  exactly once (native via the ext, legacy via the dispatcher — never both).
  Same `429` + `Retry-After: 60`. Add a through-hapi integration assertion that
  the default bucket still trips at the 201st request (proves no double-count).
- [ ] T012 Native routes for `/api/repo-status`, `/api/repos`, `/api/pr-status`
  (`routes/repos/`). `bearer-scope` with `read` scope. Delete legacy rows +
  `getRequiredScope` entries. Migrate tests incl. the auth matrix (401/403/
  `LORE_INGEST_TOKEN`). (FR4, FR5, SC-3)

## Phase 4 — Context + graph group (PR)

- [ ] T013 Native routes for `/api/context`, `/api/graph` (`routes/context/`,
  `routes/graph/`), `read` scope. Delete legacy rows + scope entries. Migrate
  tests. (FR5, SC-3)

## Phase 5 — Tasks (read) group (PR)

- [ ] T014 Native routes for `/api/task/:id`, `/api/tasks`,
  `/api/tasks/:id/timeline`, `/api/tasks/by-pr/*`, `GET /api/task-logs`,
  `/api/job-run-logs` (`routes/tasks/`). Typed path params replace the regex
  ordering (`:id/timeline` before `:id`). `read` scope. Delete legacy rows +
  scope entries. Migrate tests. (FR5, SC-3)

## Phase 6 — Tasks (write) group (PR)

- [ ] T015 Native routes for `POST /api/task`, `POST /api/task-logs`
  (`routes/tasks/`). `task` scope + `task` rate-limit bucket. Body cap via route
  `payload.maxBytes`. Delete legacy rows + scope entries. Migrate tests incl.
  the `task`-bucket 429 threshold. (FR5, SC-3, SC-4)

## Phase 7 — Memory group (PR)

- [ ] T016 Native routes for `POST /api/memory`, `/api/episode`,
  `/api/session-summary` (`routes/memory/`). `write` scope. Delete legacy rows +
  scope entries. Migrate tests. (FR5, SC-3)

## Phase 8 — Ingest group (PR)

- [ ] T017 Native routes for `POST /api/ingest`, `/api/repos/:o/:r/ingest-graph`
  (`routes/ingest/`). `write` scope; typed `:o/:r` params. Delete legacy rows +
  scope entries. Migrate tests. (FR5, SC-3)

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
