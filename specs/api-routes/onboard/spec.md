# Feature Specification: POST /api/onboard

| Field      | Value                                          |
|------------|------------------------------------------------|
| Feature    | Onboard repo HTTP route                         |
| Status     | **Draft**                                       |
| Created    | 2026-06-10                                      |
| Owner      | Platform Engineering                           |
| Route      | `POST /api/onboard`                            |
| Auth scope | `admin`                                         |
| Module     | `mcp-server/src/api/routes/ingest.ts` (`handleOnboard`) |

## Problem Statement

Bringing a repo into Lore is a privileged, side-effecting operation: it inspects
the repo and opens a PR adding `CLAUDE.md`, `AGENTS.md`, ADRs, a PR template, and
CI workflows, and registers the repo for nightly ingestion. Because it writes to
an external repo and creates a `lore.repos` row, it must be gated behind the
strongest token scope. This route is the HTTP surface the `/onboard` UI and the
`lore_onboard_repo` MCP tool call.

## Interface

- **Method + path**: `POST /api/onboard`
- **Auth**: bearer token with `admin` scope. `getRequiredScope` maps the
  `/api/onboard` prefix → `admin` in `ROUTE_SCOPES`. Missing bearer → 401;
  non-admin token → 403 (dispatcher).

### Request

JSON body:

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `repo` | string | yes | — | Must be `owner/name` — validated by an `includes("/")` check. |

### Response

| Status | Body |
|--------|------|
| 200 | The `onboardRepo` result object. |
| 400 | `{ "error": "required: repo (owner/name format)" }` |
| 500 | `{ "error": "<err.message>" }` |
| 503 | `{ "error": "database not available" }` (pool is null). |

## Behavior

1. If `pool` is null → 503 `{ error: "database not available" }`; return.
2. Read the raw body via `readBody`.
3. `JSON.parse(body)` inside a try; failures caught at step 6.
4. Destructure `{ repo }`. If `repo` is falsy **or** `!repo.includes("/")` → 400
   with the verbatim required-fields error; return.
5. `await onboardRepo(pool, repo)`
   ([feature](../../../mcp-server/src/features/repo/repo-onboard.js)); write 200
   with the result.
6. **Catch** — log `[onboard] API error: <message>` and write 500
   `{ error: err.message }`.

## Output

- **Success**: 200, body = the `onboardRepo` result.
- **Validation failure**: 400, `{ error: "required: repo (owner/name format)" }`.
- **Engine / parse error**: 500, `{ error: "<message>" }`.
- **No DB**: 503, `{ error: "database not available" }`.

## Dependencies & side effects

- `onboardRepo` (`features/repo/repo-onboard.ts`) — inspects the repo, opens a
  bootstrap PR, inserts/updates `lore.repos`. (GitHub API + DB writes.)
- Auth env `LORE_INGEST_TOKEN`, `pipeline.api_tokens` (dispatcher).

## Acceptance Criteria

A null pool returns 503 before any parsing. ([validated by `returns 503 when pool is null`](../../../mcp-server/src/api/routes/onboard.test.ts#L21))

A repo without a slash returns 400. ([validated by `returns 400 when repo is missing or malformed`](../../../mcp-server/src/api/routes/onboard.test.ts#L27))

A valid repo returns 200 with the onboard result. ([validated by `returns 200 with the onboard result`](../../../mcp-server/src/api/routes/onboard.test.ts#L34))

A throwing `onboardRepo` returns 500. ([validated by `returns 500 when onboardRepo throws`](../../../mcp-server/src/api/routes/onboard.test.ts#L42))

The route is registered as an exact `POST /api/onboard` match. ([implemented by](../../../mcp-server/src/api/routes/index.ts#L54)) ([implemented by](../../../mcp-server/src/api/routes/ingest.ts#L41))

## Out of Scope

- The repo inspection / bootstrap-PR generation internals (`onboardRepo`).
- Nightly ingestion scheduling.
- Bearer-token validation mechanics (owned by `auth.ts`).
