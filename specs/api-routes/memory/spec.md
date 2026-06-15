# Feature Specification: POST /api/memory HTTP Route

| Field      | Value                                                   |
|------------|---------------------------------------------------------|
| Feature    | POST /api/memory HTTP Route                              |
| Status     | **Draft**                                                |
| Created    | 2026-06-10                                               |
| Owner      | Platform Engineering                                     |
| Route      | `POST /api/memory`                                       |
| Auth scope | `write`                                                  |
| Module     | Memory routes (`api/routes/memory.ts` → `handleMemory`) |

## Problem Statement

The Lore MCP server runs locally in stdio mode and proxies every memory
operation to the shared GKE backend over HTTP. The five memory tool actions
(`write`, `read`, `search`, `delete`, `list`) therefore need one HTTP endpoint
that dispatches on an `action` discriminator, transparently falls back to a
file-backed store when the memory database is unavailable, and computes a query
embedding once for the paths that need vector search. `POST /api/memory` is that
single multiplexed endpoint: it never throws past the handler boundary, returns
the tool result as JSON on success, and returns a structured `{ error }` JSON
object on every validation or runtime failure.

## Interface

Registered in the route table as `exact("/api/memory", "POST")`
([registration](../../../apps/mcp-server/src/api/routes/index.ts#L61)), dispatched by
`handleApiRoute` after the cross-cutting rate-limit + bearer-scope gates.

- **Method + path**: `POST /api/memory`
- **Auth scope**: `write` — `ROUTE_SCOPES["/api/memory"] = "write"`
  ([scope map](../../../apps/mcp-server/src/api/routes/auth.ts#L44)). No
  `SCOPE_OVERRIDES` entry applies. A bearer token is mandatory (the route is not
  auth-exempt); `admin` scope satisfies it, `read`-only does not.
- **Rate bucket**: `default` (200/min) — the URL is neither `/api/webhook/*` nor
  a `/api/task*` path.

### Request body (JSON)

A single object whose `action` field selects the operation. Fields consumed:
`action`, `key`, `value`, `agent_id`, `ttl`, `query`, `limit`, `version`,
`pool_name`, `repo`.

| Action  | Required fields | Optional fields                          | Effect                                              |
|---------|-----------------|------------------------------------------|-----------------------------------------------------|
| `write` | `key`, `value`  | `agent_id`, `ttl`, `repo`                | Store a key/value memory (with embedding when DB).  |
| `read`  | `key`           | `agent_id`, `version` (`all` \| number)  | Retrieve latest, a numeric version, or all history. |
| `search`| `query`         | `agent_id`, `pool_name`, `limit` (10)    | Semantic search across memories.                    |
| `delete`| `key`           | `agent_id`                               | Soft-delete a memory.                               |
| `list`  | —               | `agent_id`, `limit` (50)                  | Paginated active-memory listing (offset 0).         |

### Response

- **200**: the raw tool result JSON (`writeMemory`/`readMemory`/`searchMemories`/
  `deleteMemory`/`listMemories`, or the `*File` fallback equivalent).
- **400**: `{ error: <missing-field message> }` for missing required fields or an
  unknown action.
- **401 / 403**: emitted by the shared auth gate before the handler runs.
- **500**: `{ error: <err.message> }` on a JSON parse error or thrown dependency.

## Behavior

Numbered control flow of `handleMemory(req, res, pool)`:

1. Read the full request body string via `readBody(req)`.
2. `JSON.parse(body)` inside a `try`; destructure `action, key, value, agent_id,
   ttl, query, limit, version, pool_name, repo`. A parse failure jumps to the
   `catch` → `json(res, 500, { error: err.message })`.
3. **Embedding precompute** — when `action` is `write` or `search` **and** a
   `value`/`query` string is present, compute `embedding = await
   getQueryEmbedding(value || searchQuery)`; otherwise `embedding = null`. This
   runs once, before the dispatch, so the embedder is called for the write and
   search paths only.
4. **Dispatch** on `action`:
   1. `write`: enforce `key && value` else `json(res, 400, { error: "key and
      value required" })`. If `isMemoryDbAvailable()`, call `writeMemory(key,
      value, agent_id, ttl, embedding || undefined, repo)`; else
      `writeMemoryFile(key, value, agent_id, ttl)` (no embedding, no repo).
   2. `read`: enforce `key` else `json(res, 400, { error: "key required" })`.
      Normalize `version`: `"all"` stays `"all"`, a truthy value becomes
      `Number(version)`, falsy becomes `undefined`. Call `readMemory` (DB) or
      `readMemoryFile` (file) with that resolved version.
   3. `search`: enforce `query` else `json(res, 400, { error: "query required"
      })`. DB path calls `searchMemories(pool!, searchQuery, agent_id, pool_name,
      limit || 10)`; file path calls `searchMemoryFile(searchQuery, agent_id,
      limit || 10)`.
   4. `delete`: enforce `key` else `json(res, 400, { error: "key required" })`.
      DB → `deleteMemory(key, agent_id)`; file → `deleteMemoryFile(key,
      agent_id)`.
   5. `list`: DB → `listMemories(agent_id, limit || 50, 0)`; file →
      `listMemoriesFile(agent_id, limit || 50, 0)`.
   6. default: `json(res, 400, { error: "action must be: write, read, search,
      delete, list" })` and return.
5. On any dispatched branch that produced a `result`, respond `json(res, 200,
   result)`.
6. Any error thrown by a dependency is caught → `json(res, 500, { error:
   err.message })`.

The DB-vs-file decision is taken per action via `isMemoryDbAvailable()`; there is
no per-request flag. `searchMemories` receives the live `pool` (non-null assertion
`pool!`); the other DB writers resolve their own connection internally.

## Output

| Branch                                | Status | Body (verbatim shape)                                            |
|---------------------------------------|--------|------------------------------------------------------------------|
| Successful action                     | 200    | raw tool/file result JSON                                         |
| `write` missing key or value          | 400    | `{ "error": "key and value required" }`                          |
| `read` / `delete` missing key         | 400    | `{ "error": "key required" }`                                    |
| `search` missing query                | 400    | `{ "error": "query required" }`                                  |
| unknown action                        | 400    | `{ "error": "action must be: write, read, search, delete, list" }`|
| JSON parse error / thrown dependency  | 500    | `{ "error": <err.message> }`                                     |
| no bearer token (auth gate)           | 401    | `{ "error": "unauthorized" }`                                    |
| token without `write` scope (gate)    | 403    | `{ "error": "insufficient scope" }`                              |

## Dependencies & side effects

- **Handlers**: `writeMemory` / `readMemory` / `deleteMemory` / `listMemories`
  and `isMemoryDbAvailable` from `features/memory/memory.ts`; `searchMemories`
  from `features/memory/memory-search.ts`; the `*File` family from
  `features/memory/memory-file.ts`.
- **Embeddings**: `getQueryEmbedding` from `platform/db.ts` (Vertex AI).
- **DB tables** (DB path): `memory.memories`, `memory.memory_versions`. File path
  writes to `~/.lore/memory/`.
- **Env**: `LORE_INGEST_TOKEN` (legacy full-access bearer) consulted by the auth
  gate; embedding generation reads Vertex/GCP credentials.
- **No side effects on validation failures** — a 400 short-circuits before any
  store call.

## Acceptance Criteria

A `write` with a `value` present computes the embedding for `value` and persists
via the DB writer, returning its result. ([validated by `writes via DB when
memory DB available`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L45))

When the memory DB is unavailable, `write` routes to the file fallback writer.
([validated by `writes via file fallback when memory DB unavailable`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L53))

A `write` missing `value` returns 400 without calling a store. ([validated by
`returns 400 when write is missing value`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L60))

A `read` with a numeric `version` string is coerced to a number before the DB
read. ([validated by `reads via DB`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L65))

A `read` with `version=all` passes `"all"` through unchanged. ([validated by
`reads full history via DB with version=all`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L73))

A `read` with no version passes `undefined` (latest). ([validated by `reads
latest via DB when no version given`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L80))

A falsy embedding result is passed to the writer as `undefined`, not the falsy
value. ([validated by `writes with undefined embedding when the embedder returns
falsy`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L108))

A `read` missing `key` returns 400. ([validated by `returns 400 when read is
missing key`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L116))

A `search` computes the embedding for `query` and returns the DB search result.
([validated by `searches via DB`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L121))

A `search` falls back to the file searcher with `limit` defaulting to 10.
([validated by `searches via file fallback`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L129))

A `search` missing `query` returns 400. ([validated by `returns 400 when search
is missing query`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L136))

A `delete` missing `key` returns 400. ([validated by `returns 400 when delete is
missing key`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L155))

A `list` defaults `limit` to 50 and offset to 0. ([validated by `lists via
DB`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L160))

An unrecognized action returns 400 with the action-list message. ([validated by
`returns 400 for an unknown action`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L174))

A malformed JSON body returns 500. ([validated by `returns 500 on invalid
JSON`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L179))

A request with no bearer token is rejected 401 before dispatch. ([validated by
`returns 401 when the bearer token is absent`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L185))

A token whose scopes lack `write` is rejected 403 before dispatch. ([validated by
`returns 403 when the token lacks write scope`](../../../apps/mcp-server/src/api/routes/memory.test.ts#L191))

The embedding-vector contents and the live semantic-ranking output of
`searchMemories`/`getQueryEmbedding` are exercised only against live Postgres +
Vertex. *(untested: embedding generation and RRF ranking are live-IO; the route
seam mocks the embedder and store and asserts only the dispatch/argument
contract.)*

## Out of Scope

- The internal storage, versioning, decay, and conflict logic of
  `writeMemory`/`readMemory`/etc. — owned by the memory feature module.
- Semantic ranking / RRF inside `searchMemories`.
- Embedding generation (`getQueryEmbedding`, Vertex AI).
- The file-store layout under `~/.lore/memory/`.
- Token issuance and the scope schema (`/api/tokens`).

Code: handler [`handleMemory`](../../../apps/mcp-server/src/api/routes/memory.ts#L14)
(IMPLEMENTED_BY); route [registration](../../../apps/mcp-server/src/api/routes/index.ts#L61).
