# Feature Specification: /api/tokens API Route

| Field       | Value                                                       |
|-------------|-------------------------------------------------------------|
| Feature     | /api/tokens API Route                                       |
| Status      | **Draft**                                                   |
| Created     | 2026-06-10                                                  |
| Owner       | Platform Engineering                                        |
| Route       | `GET / POST /api/tokens` (path-only match)                  |
| Auth scope  | **admin** (`SCOPE_OVERRIDES` → `/api/tokens` = `admin`)     |
| Module      | `mcp-server/src/api/routes/tokens.ts` (`handleTokens`)      |

## Problem Statement

The MCP server accepts per-client bearer tokens with coarse scopes
(`read`/`write`/`task`/`webhook`/`admin`) instead of a single shared secret.
Operators need to mint scoped tokens for CI, list which tokens are live, and
revoke a leaked one — all without ever being able to read an existing token's
secret back. `/api/tokens` is the admin-only management surface: tokens are
stored only as SHA-256 hashes, the raw token is returned exactly once at
creation, and listing returns metadata only.

## Interface

Registered with a path-only matcher (`url === "/api/tokens"`, both verbs route
here; method is resolved inside the handler)
([registration](../../../apps/mcp-server/src/api/routes/index.ts#L70)).

- **Auth**: `admin` scope, enforced by the dispatcher *before* the handler runs.
  `getRequiredScope("/api/tokens")` returns `"admin"` from the `ROUTE_SCOPES`
  prefix map ([scope map](../../../apps/mcp-server/src/api/routes/auth.ts#L55)). A
  read/write token is rejected with `403 { error: "insufficient scope" }`; an
  `admin`-scoped token or the legacy `LORE_INGEST_TOKEN` passes.

### `GET /api/tokens` — list active tokens

- Request: none.
- Response `200 { tokens: Row[] }` where each row is
  `{ id, name, scopes, created_by, expires_at, last_used, created_at }`. The
  `token_hash` column is never selected; the raw token is never returned.

### `POST /api/tokens` — create or revoke

- Request body (JSON): `{ action?, name?, scopes?, expires_in_days?, token_id? }`.
  - **Revoke**: `{ action: "revoke", token_id }`.
  - **Create**: `{ name, scopes?, expires_in_days? }` (no `action`).
- Response:
  - Revoke → `200 { ok: true }`.
  - Create → `201 { id, name, scopes, created_at, token, expires_at }` where
    `token` is the one-time raw secret.
  - Missing `name` on create → `400 { error: "name required" }`.
  - Thrown error (bad JSON, insert failure) → `500 { error: <message> }`.

### Other methods

`405 { error: "method not allowed" }`.

## Behavior

1. **Pool gate** — if `pool` is null, respond `503 { error: "database not
   available" }` and return.
2. Read `method = req.method`.
3. **GET branch**:
   1. `SELECT id, name, scopes, created_by, expires_at, last_used, created_at
      FROM pipeline.api_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC`.
   2. Respond `200 { tokens: rows }`.
4. **POST branch** (wrapped in try/catch; any throw → `500 { error: message }`):
   1. `readBody(req)` then `JSON.parse` → `{ action, name, scopes,
      expires_in_days, token_id }`.
   2. **Revoke** — if `action === "revoke"` and `token_id` is truthy:
      `UPDATE pipeline.api_tokens SET revoked_at = now() WHERE id = $1`; respond
      `200 { ok: true }`; return.
   3. **Create**:
      1. If `!name` → `400 { error: "name required" }`; return.
      2. Generate `rawToken = "lore_" + randomBytes(32).toString("hex")`
         (64 hex chars).
      3. `tokenHash = sha256(rawToken)` hex digest (only the hash is stored).
      4. Filter `scopes` (default `["read"]`) down to the valid set
         `["read","write","task","webhook","admin"]`.
      5. `expiresAt = expires_in_days ? now + days*86400000 (ISO) : null`.
      6. `INSERT INTO pipeline.api_tokens (name, token_hash, scopes, created_by,
         expires_at) VALUES (…) RETURNING id, name, scopes, created_at`, with
         `created_by = "admin"`.
      7. Respond `201 { ...row, token: rawToken, expires_at }` — the raw token is
         surfaced exactly once and is unrecoverable afterward.
5. **Fallthrough** — neither GET nor POST → `405 { error: "method not allowed" }`.

## Output

- `503 { error: "database not available" }` — null pool ([validated by `returns
  503 when pool is null`](../../../apps/mcp-server/src/api/routes/tokens.test.ts#L17)).
- `200 { tokens: [...] }` — GET ([validated by `lists active tokens on
  GET`](../../../apps/mcp-server/src/api/routes/tokens.test.ts#L22)).
- `200 { ok: true }` — revoke ([validated by `revokes a token on
  POST`](../../../apps/mcp-server/src/api/routes/tokens.test.ts#L29)).
- `400 { error: "name required" }` — create without name ([validated by `returns
  400 when creating without a name`](../../../apps/mcp-server/src/api/routes/tokens.test.ts#L36)).
- `201 { …, token: "lore_<64 hex>", expires_at }` — create; invalid scopes
  filtered, `expires_in_days` → ISO timestamp ([validated by `creates a token,
  filtering invalid scopes and computing expiry`](../../../apps/mcp-server/src/api/routes/tokens.test.ts#L42)).
- `201` with `expires_at: null` — create without `expires_in_days` ([validated by
  `creates a token with default scope and no expiry`](../../../apps/mcp-server/src/api/routes/tokens.test.ts#L51)).
- `500 { error: <message> }` — insert throws ([validated by `returns 500 when the
  insert throws`](../../../apps/mcp-server/src/api/routes/tokens.test.ts#L58)).
- `405 { error: "method not allowed" }` — unsupported / absent method ([validated
  by `returns 405 for unsupported methods`](../../../apps/mcp-server/src/api/routes/tokens.test.ts#L65)).

Verbatim strings: `"database not available"`, `"name required"`, `"method not
allowed"`, the `"lore_"` token prefix, the `created_by` literal `"admin"`.

## Dependencies & side effects

- Handler: `handleTokens` ([code](../../../apps/mcp-server/src/api/routes/tokens.ts#L7)).
- DB table `pipeline.api_tokens` (columns: `id, name, token_hash, scopes,
  created_by, expires_at, last_used, revoked_at, created_at`): GET reads,
  create INSERTs, revoke UPDATEs `revoked_at`.
- `node:crypto` — `randomBytes(32)` (token), `createHash("sha256")` (hash).
- `readBody` from `http.ts` (1 MB cap; oversize body surfaces as a parse/throw →
  `500`).
- Auth coupling: the same `pipeline.api_tokens.token_hash` column is what
  `validateClientToken` matches on for *every* `/api/*` route, and a successful
  validation bumps `last_used` (see [auth scope override test
  `returns admin for the tokens route`](../../../apps/mcp-server/src/api/routes/auth.test.ts#L13)).
- Env: `LORE_INGEST_TOKEN` (legacy full-access token also satisfies the admin gate).

## Acceptance Criteria

A null pool returns `503 { error: "database not available" }`. ([validated by
`returns 503 when pool is null`](../../../apps/mcp-server/src/api/routes/tokens.test.ts#L17))

GET returns only metadata rows for non-revoked tokens, never a secret. ([validated
by `lists active tokens on GET`](../../../apps/mcp-server/src/api/routes/tokens.test.ts#L22))

`{ action: "revoke", token_id }` marks the token revoked and returns `{ ok: true }`.
([validated by `revokes a token on POST`](../../../apps/mcp-server/src/api/routes/tokens.test.ts#L29))

Creating without a `name` returns `400 { error: "name required" }`. ([validated by
`returns 400 when creating without a name`](../../../apps/mcp-server/src/api/routes/tokens.test.ts#L36))

Creation returns a one-time `lore_`-prefixed 64-hex token, filters out invalid
scopes, and computes an ISO expiry from `expires_in_days`. ([validated by `creates
a token, filtering invalid scopes and computing
expiry`](../../../apps/mcp-server/src/api/routes/tokens.test.ts#L42))

Creation without `expires_in_days` yields `expires_at: null`. ([validated by
`creates a token with default scope and no
expiry`](../../../apps/mcp-server/src/api/routes/tokens.test.ts#L51))

An insert failure surfaces as `500 { error: <message> }`. ([validated by `returns
500 when the insert throws`](../../../apps/mcp-server/src/api/routes/tokens.test.ts#L58))

Any non-GET/POST verb (including an absent method) returns `405 { error: "method
not allowed" }`. ([validated by `returns 405 for unsupported
methods`](../../../apps/mcp-server/src/api/routes/tokens.test.ts#L65))

The route requires `admin` scope; the dispatcher 403s a read-scoped token before
the handler runs. ([validated by `returns admin for the tokens
route`](../../../apps/mcp-server/src/api/routes/auth.test.ts#L13) and `returns 403 when
the DB token lacks the admin scope an admin route
needs`](../../../apps/mcp-server/src/api/routes/dispatch.test.ts#L145))

## Out of Scope

- The cross-cutting bearer-token validation + scope check — owned by the
  dispatcher and `validateClientToken` in `auth.ts`.
- Token rotation, per-scope rate limits, and audience binding (not implemented).
- The DDL/migration that creates `pipeline.api_tokens`.
