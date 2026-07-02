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

## Phase 1 — Strangler seam: hapi hosts 100% of traffic (PR #1) (FR1, FR3, FR4)

- [ ] T003 Add deps to `apps/lore-api/package.json`: `@hapi/hapi`, `@hapi/boom`,
  `@types/hapi__hapi` — pin to floor's versions (`@hapi/hapi ^21.4.9`).
- [ ] T004 Create `apps/lore-api/src/server/build-server.ts`:
  `buildServer(getPool) -> Server`. Registers the plugins (T006–T008), the
  catch-all bridge (T005), and (initially) no native routes. **One** construction
  site, shared by prod boot and the integration tests.
- [ ] T005 Add the catch-all bridge route in `build-server.ts`:
  `method: "*", path: "/{any*}", options: { auth: false }`; handler calls
  `handleApiRoute(request.raw.req, request.raw.res, getPool())`, returns
  `h.response().code(404)` when unhandled else `h.abandon`. This delegates every
  not-yet-migrated route to the existing dispatcher.
- [ ] T006 `apps/lore-api/src/server/plugins/bearer-scope.ts`: hapi auth
  scheme/strategy wrapping `validateClientToken`. Authenticates the bearer once,
  sets `credentials.scope` from `pipeline.api_tokens` (admin ⇒ all); preserves
  the `LORE_INGEST_TOKEN` full-access fallback. Register as the default strategy;
  the catch-all opts out with `auth: false`.
- [ ] T007 `apps/lore-api/src/server/plugins/rate-limit.ts`: `onPreAuth` server
  ext reusing the exact sliding-window bucket logic; move `webhook`/`task`/
  `default` bucket selection into the ext. Same thresholds + `429` +
  `Retry-After: 60`.
- [ ] T008 `apps/lore-api/src/server/plugins/body-cap.ts`: hapi `payload`
  defaults (`maxBytes: 1_048_576`) applied via the server config. (Manual caps in
  `index.ts`/`http.ts` stay until no legacy route depends on them — removed at
  teardown.)
- [ ] T009 Rewrite `apps/lore-api/src/server/http-server.ts` to a thin
  `startHttpServer() -> buildServer(getPool).start()`; point `src/index.ts` at it.
  No bare `createServer` in the boot path.
- [ ] T010 Port the integration/proxy/pipeline/webhook harness to drive the hapi
  server via `buildServer` (inject via `server.inject` or bind a port).
  Full suite green through the catch-all bridge. (SC-2, SC-5)

## Phase 2 — Infra group (no auth, no DB) (PR)

- [ ] T011 Native hapi routes for `/healthz` and `/dist/lore-code-trace/*`
  (`routes/healthz/`, `routes/dist/`); `auth: false`. Delete their rows from
  `API_ROUTES` in `routes/index.ts`. Migrate their tests. (SC-5)

## Phase 3 — Repos (read) group (PR)

- [ ] T012 Native routes for `/api/repo-status`, `/api/repos`, `/api/pr-status`
  (`routes/repos/`). `bearer-scope` with `read` scope. Delete legacy rows +
  `getRequiredScope` entries. Migrate tests incl. the auth matrix (401/403/
  `LORE_INGEST_TOKEN`). (FR5, SC-3)

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
