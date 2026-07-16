# Feature Specification: GET /healthz API Route

| Field       | Value                                                  |
|-------------|--------------------------------------------------------|
| Feature     | GET /healthz API Route                                 |
| Status      | In Progress                                            |
| Created     | 2026-06-10                                             |
| Owner       | Platform Engineering                                   |
| Route       | `GET /healthz` (any method; matched on path only)      |
| Auth scope  | **none** — unauthenticated; rate-limit-exempt          |
| Module      | `mcp-server/src/api/routes/health.ts` (`handleHealthz`) |

GET /healthz is an unauthenticated liveness probe reporting whether the MCP server is up and its database reachable, upgrading to full database and task-counter diagnostics for callers presenting a valid read-scoped token.

## Problem Statement

A load balancer, a Kubernetes liveness probe, and an operator all need a cheap,
unauthenticated way to ask "is this MCP server up, and is its database
reachable?" without presenting a bearer token. The same endpoint should reveal
richer diagnostics (database health detail + task counters) to a caller who
*does* present a valid read-scoped token, without leaking those internals to an
anonymous prober. `GET /healthz` is that dual-audience liveness probe: a public
two-field response, upgraded to a full diagnostic payload when authenticated.

## Interface

Registered as the first entry in the route table, matched on path only
(`url === "/healthz"`, method-agnostic)
([registration](../../../apps/mcp-server/src/api/routes/index.ts#L51)).

- **Method + path**: `GET /healthz` (the matcher ignores method; any verb on
  `/healthz` dispatches here).
- **Auth**: none. The dispatcher exempts `/healthz` from both the rate limiter
  (`url !== "/healthz"` gate) and the bearer-token gate (`authExempt`)
  ([dispatch gates](../../../apps/mcp-server/src/api/routes/index.ts#L88)).
- **Request**: no body, no required query params. An optional
  `Authorization: Bearer <token>` header upgrades the response.
- **Response**:
  - `200` when healthy (or DB down but `LORE_DB_HOST` unset).
  - `503` when the DB is disconnected **and** `LORE_DB_HOST` is set.
  - Body is the minimal `{ status }` for anonymous callers; the full
    `{ status, database, tasks }` for a caller whose token validates at `read`
    scope.

## Behavior

1. Call `getHealthStatus()` → `{ connected, … }`
   ([db.getHealthStatus](../../../apps/mcp-server/src/platform/db.js)).
2. Compute `status`: `"ok"` when `health.connected` is true **or**
   `process.env.LORE_DB_HOST` is unset; otherwise `"error"`. (Rationale: in a
   no-DB deployment the server is still a healthy liveness target.)
3. Compute `code`: `503` when `status === "error"`, else `200`.
4. Extract the bearer token (`Authorization` header, `Bearer ` stripped). If
   present, call `validateClientToken(pool, bearer, "read")`; absent → not
   authed.
5. **Authenticated branch** (`isAuthed` true):
   1. Default `tasks = { processed_today: 0, pending: 0 }`.
   2. If `health.connected` **and** `pool` is non-null, run
      `SELECT count(*) FILTER (WHERE created_at > current_date) AS today,
      count(*) FILTER (WHERE status = 'pending') AS pending FROM pipeline.tasks`
      and set `tasks` from the row (`today`/`pending`, each `|| 0`). Any throw is
      swallowed (`tasks` stays zeroed).
   3. Respond `code` with `{ status, database: health, tasks }`.
6. **Anonymous branch**: respond `code` with `{ status }` only.

## Output

- `200 { status: "ok" }` — anonymous, connected ([validated by `returns 200
  {status:ok} unauthenticated when connected`](apps/lore-api/src/api/routes/healthz/healthz.test.ts#L41)).
- `503 { status: "error" }` — disconnected with `LORE_DB_HOST` set ([validated by
  `returns 503 {status:error} when disconnected and LORE_DB_HOST set`](apps/lore-api/src/api/routes/healthz/healthz.test.ts#L48)).
- `200 { status: "ok" }` — disconnected with no `LORE_DB_HOST` ([validated by
  `returns 200 ok when disconnected but no LORE_DB_HOST configured`](apps/lore-api/src/api/routes/healthz/healthz.test.ts#L57)).
- `200 { status, database, tasks }` — authenticated + connected ([validated by
  `includes database + task stats when authenticated and connected`](apps/lore-api/src/api/routes/healthz/healthz.test.ts#L64)).
- The `error` value verbatim is the string `"error"`; the `ok` value verbatim is
  the string `"ok"`.

## Dependencies & side effects

- Handler: `handleHealthz` ([code](../../../apps/mcp-server/src/api/routes/health.ts#L7)).
- `getHealthStatus()` from `platform/db.ts` (read-only connectivity probe).
- `validateClientToken(pool, bearer, "read")` from `auth.ts` (a *successful* DB
  validation issues an `UPDATE pipeline.api_tokens SET last_used = now()` as a
  side effect — see [tokens spec](../tokens/spec.md)).
- DB read: `pipeline.tasks` count query (authed + connected path only).
- Env: `LORE_DB_HOST` (drives the down-but-not-configured grace), `LORE_INGEST_TOKEN`
  (legacy full-access token accepted by `validateClientToken`).
- No writes by the handler itself.

## Acceptance Criteria

An anonymous probe against a connected server returns `200 { status: "ok" }` with
no database/tasks detail. ([validated by `returns 200 {status:ok} unauthenticated
when connected`](apps/lore-api/src/api/routes/healthz/healthz.test.ts#L41))

A disconnected DB with `LORE_DB_HOST` configured returns `503 { status: "error" }`.
([validated by `returns 503 {status:error} when disconnected and LORE_DB_HOST
set`](apps/lore-api/src/api/routes/healthz/healthz.test.ts#L48))

A disconnected DB with no `LORE_DB_HOST` configured stays `200 { status: "ok" }`.
([validated by `returns 200 ok when disconnected but no LORE_DB_HOST
configured`](apps/lore-api/src/api/routes/healthz/healthz.test.ts#L57))

An authenticated probe on a connected server adds `database` and `tasks` counters.
([validated by `includes database + task stats when authenticated and
connected`](apps/lore-api/src/api/routes/healthz/healthz.test.ts#L64))

A failing task-stats query degrades to zeroed counters rather than erroring.
([validated by `falls back to zeroed task stats when the stats query
throws`](apps/lore-api/src/api/routes/healthz/healthz.test.ts#L77))

An authenticated probe with a null pool skips the stats query and returns zeroed
counters. ([validated by `skips the stats query when authed but pool is
null`](apps/lore-api/src/api/routes/healthz/healthz.test.ts#L89))

A stats query returning no rows zeroes the counters. ([validated by `zeroes task
stats when the stats query returns no rows`](apps/lore-api/src/api/routes/healthz/healthz.test.ts#L97))

The dispatcher exempts `/healthz` from rate limiting and bearer auth (no 401/403/429
is ever returned on this path). ([validated by `returns 200 {status:ok}
unauthenticated when connected`](apps/lore-api/src/api/routes/healthz/healthz.test.ts#L41), [validated by `rate-limit.test.ts:84`](apps/lore-api/src/server/plugins/rate-limit.test.ts#L84))

## Out of Scope

- Readiness vs. liveness distinction — this is a single combined probe.
- The `GET /api/repo-status` handler that shares `health.ts` — separate route,
  separate spec.
- The internals of `getHealthStatus()` (pool ping, timeout) — owned by `platform/db.ts`.
- Token validation internals — owned by the [tokens spec](../tokens/spec.md).
