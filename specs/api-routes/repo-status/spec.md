# Feature Specification: GET /api/repo-status

| Field      | Value                                          |
|------------|------------------------------------------------|
| Feature    | Repo status HTTP route                          |
| Status     | **Draft**                                       |
| Created    | 2026-06-10                                      |
| Owner      | Platform Engineering                           |
| Route      | `GET /api/repo-status`                         |
| Auth scope | `read`                                          |
| Module     | `mcp-server/src/api/routes/health.ts` (`handleRepoStatus`) |

## Problem Statement

The statusline, the `assemble_context` freshness warning, and the UI need a cheap
read that answers: is this repo onboarded, how many tasks are in flight, how many
PRs are awaiting a human, how many memories exist, is auto-review on, and is the
ingested context stale (>7 days). One endpoint returns all of it, degrading
gracefully (never 5xx) so a missing repo or a transient DB error still renders a
usable statusline.

## Interface

- **Method + path**: `GET /api/repo-status`
- **Auth**: bearer token with `read` scope. `getRequiredScope` maps the
  `/api/repo-status` prefix → `read`. Missing bearer → 401; insufficient scope →
  403 (dispatcher).

### Request — query params

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `repo` | string | no | — | `owner/name`. Absent (or null pool) → `{ onboarded: false }`. |

### Response

Always `200` JSON. Shape depends on the branch.

| Branch | Body |
|--------|------|
| no repo or no pool | `{ "onboarded": false }` |
| repo not in `lore.repos` | `{ "onboarded": false, "repo": "<repo>" }` |
| onboarded | `{ onboarded: true, repo, running, pr_ready, memories, auto_review, last_ingested_at, stale }` |
| query error | `{ "onboarded": false, "error": "<message>" }` |

## Behavior

1. Parse `req.url` with base `http://${req.headers.host}`; read `repo`. Log
   `[repo-status] repo=<repo> dbPoolRef=<bool>`.
2. If `repo` is falsy **or** `pool` is null → 200 `{ onboarded: false }`; return.
3. **Repo lookup** — `SELECT settings, last_ingested_at FROM lore.repos WHERE
   full_name = $1`. Zero rows → 200 `{ onboarded: false, repo }`; return.
4. `settings = rows[0].settings || {}`; `lastIngested = rows[0].last_ingested_at
   || null`.
5. Three count queries (run sequentially):
   - `running` ← `count(*) FROM pipeline.tasks WHERE target_repo = $1 AND status = 'running'`
   - `pr_ready` ← `count(*) … WHERE target_repo = $1 AND status IN ('pr-created','review')`
   - `memories` ← `count(*) FROM memory.memories WHERE is_deleted = false`
6. `stale = !lastIngested || (now − lastIngested) > 7·86400000` ms.
7. Write 200 `{ onboarded: true, repo, running, pr_ready, memories,
   auto_review: settings.auto_review === true, last_ingested_at: lastIngested,
   stale }` — counts coerced via `Number(rows[0]?.c || 0)`.
8. **Catch** — log `[repo-status] Error: <message>` and write 200
   `{ onboarded: false, error: err.message }`.

## Output

- **Onboarded**: 200 with the full stats object (counts numeric, `auto_review`
  strict-equality boolean, `stale` boolean).
- **Not onboarded / no input**: 200 `{ onboarded: false[, repo] }`.
- **DB error**: 200 `{ onboarded: false, error: "<message>" }` — never 5xx.

## Dependencies & side effects

- DB reads only: `lore.repos`, `pipeline.tasks`, `memory.memories`.
- Auth env `LORE_INGEST_TOKEN`, `pipeline.api_tokens` (dispatcher).
- No writes; no fan-out.

## Acceptance Criteria

A null pool returns `{ onboarded: false }`. ([validated by `returns onboarded:false when pool is null`](../../../mcp-server/src/api/routes/repo-status.test.ts#L17))

A missing `repo` param returns `{ onboarded: false }`. ([validated by `returns onboarded:false when no repo param`](../../../mcp-server/src/api/routes/repo-status.test.ts#L23))

A repo absent from `lore.repos` returns `{ onboarded: false, repo }`. ([validated by `returns onboarded:false with repo when repo not in DB`](../../../mcp-server/src/api/routes/repo-status.test.ts#L30))

A fresh onboarded repo returns numeric counts, `auto_review`, and `stale: false`. ([validated by `returns full stats with stale=false for a fresh repo`](../../../mcp-server/src/api/routes/repo-status.test.ts#L38))

A null `last_ingested_at` marks `stale: true`. ([validated by `marks stale=true when last_ingested_at is null`](../../../mcp-server/src/api/routes/repo-status.test.ts#L58))

Null settings and missing count rows coerce to defaults (counts 0, `auto_review` false). ([validated by `handles null settings and count rows missing`](../../../mcp-server/src/api/routes/repo-status.test.ts#L70))

A throwing query returns `{ onboarded: false, error }` with status 200. ([validated by `returns onboarded:false with error when a query throws`](../../../mcp-server/src/api/routes/repo-status.test.ts#L82))

The route is registered as a `GET /api/repo-status` prefix match. ([implemented by](../../../mcp-server/src/api/routes/index.ts#L52)) ([implemented by](../../../mcp-server/src/api/routes/health.ts#L27))

## Out of Scope

- The `/healthz` handler (same module, separate route, separate spec).
- Statusline rendering of the `stale` flag.
- Bearer-token validation mechanics (owned by `auth.ts`).
