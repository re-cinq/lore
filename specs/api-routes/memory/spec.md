# Feature Specification: POST /api/memory HTTP Route

| Field      | Value                                                   |
|------------|---------------------------------------------------------|
| Feature    | POST /api/memory HTTP Route                              |
| Status     | In Progress                                              |
| Created    | 2026-06-10                                               |
| Owner      | Platform Engineering                                     |
| Route      | `POST /api/memory`                                       |
| Auth scope | `write`                                                  |
| Module     | Memory routes (`api/routes/memory.ts` → `handleMemory`) |

POST /api/memory multiplexes the five agent-memory actions (write, read, search, delete, list) over one endpoint, dispatching on an action discriminator and falling back to a file-backed store when the memory database is unavailable.

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
([registration](../../../apps/lore-api/src/server/build-server.ts#L97)), dispatched by
`handleApiRoute` after the cross-cutting rate-limit + bearer-scope gates.

- **Method + path**: `POST /api/memory`
- **Auth scope**: `write` — `ROUTE_SCOPES["/api/memory"] = "write"`
  ([scope map](../../../apps/lore-api/src/api/routes/memory/memory.ts#L77)). No
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
via the DB writer, returning its result. ([validated by `memory.test.ts:82`](apps/lore-api/src/api/routes/memory/memory.test.ts#L82))

When the memory DB is unavailable, `write` routes to the file fallback writer.
([validated by `memory.test.ts:120`](apps/lore-api/src/api/routes/memory/memory.test.ts#L120))

The body is JSON-parsed regardless of the client's `Content-Type` (ADR-034 payload override), so a JSON body sent as `application/x-www-form-urlencoded` still dispatches on `action`. ([validated by `memory.test.ts:128`](apps/lore-api/src/api/routes/memory/memory.test.ts#L128))

A `write` missing `value` returns 400 without calling a store. ([validated by `memory.test.ts:143`](apps/lore-api/src/api/routes/memory/memory.test.ts#L143))

A `read` with a numeric `version` string is coerced to a number before the DB
read, and identically on the file-fallback path. ([validated by `memory.test.ts:149`](apps/lore-api/src/api/routes/memory/memory.test.ts#L149), [validated by `memory.test.ts:172`](apps/lore-api/src/api/routes/memory/memory.test.ts#L172))

A `read` with `version=all` passes `"all"` through unchanged on both DB and file paths. ([validated by `memory.test.ts:158`](apps/lore-api/src/api/routes/memory/memory.test.ts#L158), [validated by `memory.test.ts:179`](apps/lore-api/src/api/routes/memory/memory.test.ts#L179))

A `read` with no version passes `undefined` (latest) on both DB and file paths. ([validated by `memory.test.ts:165`](apps/lore-api/src/api/routes/memory/memory.test.ts#L165), [validated by `memory.test.ts:186`](apps/lore-api/src/api/routes/memory/memory.test.ts#L186))

A falsy embedding result is passed to the writer as `undefined`, not the falsy
value. ([validated by `memory.test.ts:193`](apps/lore-api/src/api/routes/memory/memory.test.ts#L193))

A `read` missing `key` returns 400. ([validated by `memory.test.ts:208`](apps/lore-api/src/api/routes/memory/memory.test.ts#L208))

A `search` computes the embedding for `query` and returns the DB search result.
([validated by `memory.test.ts:214`](apps/lore-api/src/api/routes/memory/memory.test.ts#L214))

A `search` falls back to the file searcher with `limit` defaulting to 10.
([validated by `memory.test.ts:255`](apps/lore-api/src/api/routes/memory/memory.test.ts#L255))

A `search` missing `query` returns 400. ([validated by `memory.test.ts:262`](apps/lore-api/src/api/routes/memory/memory.test.ts#L262))

A `delete` removes the memory via the DB deleter, or the file-fallback deleter when the memory DB is unavailable. ([validated by `memory.test.ts:268`](apps/lore-api/src/api/routes/memory/memory.test.ts#L268), [validated by `memory.test.ts:276`](apps/lore-api/src/api/routes/memory/memory.test.ts#L276))

A `delete` missing `key` returns 400. ([validated by `memory.test.ts:283`](apps/lore-api/src/api/routes/memory/memory.test.ts#L283))

A `list` defaults `limit` to 50 and offset to 0, and falls back to the file lister when the memory DB is unavailable. ([validated by `memory.test.ts:289`](apps/lore-api/src/api/routes/memory/memory.test.ts#L289), [validated by `memory.test.ts:326`](apps/lore-api/src/api/routes/memory/memory.test.ts#L326))

A `list` threads `offset` through to the lister and echoes `limit`/`offset` paging metadata alongside the rows. ([validated by `memory.test.ts:299`](apps/lore-api/src/api/routes/memory/memory.test.ts#L299))

A `list` caps the requested `limit` at 100. ([validated by `memory.test.ts:316`](apps/lore-api/src/api/routes/memory/memory.test.ts#L316))

An unrecognized action returns 400 with the action-list message. ([validated by `memory.test.ts:336`](apps/lore-api/src/api/routes/memory/memory.test.ts#L336))

A malformed JSON body returns 500. ([validated by `memory.test.ts:342`](apps/lore-api/src/api/routes/memory/memory.test.ts#L342))

A request with no bearer token is rejected 401 before dispatch. ([validated by `memory.test.ts:350`](apps/lore-api/src/api/routes/memory/memory.test.ts#L350))

A token whose scopes lack `write` is rejected 403 before dispatch. ([validated by `memory.test.ts:357`](apps/lore-api/src/api/routes/memory/memory.test.ts#L357))

The embedding-vector contents and the live semantic-ranking output of
`searchMemories`/`getQueryEmbedding` are exercised only against live Postgres +
Vertex. *(untested: embedding generation and RRF ranking are live-IO; the route
seam mocks the embedder and store and asserts only the dispatch/argument
contract.)*

A search carries `include_invalidated` and `graph_augment` through to the searcher. ([validated by `forwards include_invalidated and graph_augment to the searcher`](apps/lore-api/src/api/routes/memory/memory.test.ts#L223))

Both search flags default to false when the caller omits them. ([validated by `defaults include_invalidated and graph_augment to false`](apps/lore-api/src/api/routes/memory/memory.test.ts#L244))

A write with `extract_facts` fires fact extraction for the written memory without blocking the response. ([validated by `extracts facts after a DB write when extract_facts is set`](apps/lore-api/src/api/routes/memory/memory.test.ts#L91))

A write without `extract_facts` fires no extraction. ([validated by `skips fact extraction when extract_facts is absent`](apps/lore-api/src/api/routes/memory/memory.test.ts#L112))

The extraction resolves the newest version of the written key before extracting. ([validated by `extracts from the newest version of the written memory`](apps/lore-api/src/features/memory/fact-extraction.test.ts#L14))

An unresolvable memory extracts nothing. ([validated by `does nothing when the written memory cannot be resolved`](apps/lore-api/src/features/memory/fact-extraction.test.ts#L32))

A failed lookup is swallowed so the write still succeeds. ([validated by `swallows a lookup failure so the write still succeeds`](apps/lore-api/src/features/memory/fact-extraction.test.ts#L45))

## Out of Scope

- The internal storage, versioning, decay, and conflict logic of
  `writeMemory`/`readMemory`/etc. — owned by the memory feature module.
- Semantic ranking / RRF inside `searchMemories`.
- Embedding generation (`getQueryEmbedding`, Vertex AI).
- The file-store layout under `~/.lore/memory/`.
- Token issuance and the scope schema (`/api/tokens`).

Code: handler [`handleMemory`](../../../apps/lore-api/src/api/routes/memory/memory.ts#L72)
(IMPLEMENTED_BY); route [registration](../../../apps/lore-api/src/server/build-server.ts#L97).
