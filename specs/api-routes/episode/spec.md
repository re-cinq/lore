# Feature Specification: POST /api/episode HTTP Route

| Field      | Value                                                      |
|------------|------------------------------------------------------------|
| Feature    | POST /api/episode HTTP Route                                |
| Status     | In Progress                                                 |
| Created    | 2026-06-10                                                  |
| Owner      | Platform Engineering                                        |
| Route      | `POST /api/episode`                                         |
| Auth scope | `write`                                                     |
| Module     | Memory routes (`api/routes/memory.ts` → `handleEpisode`)   |

POST /api/episode redacts, deduplicates, and persists a raw text episode for an agent, then fires asynchronous fact and knowledge-graph extraction without blocking the HTTP response.

## Problem Statement

Episodes are raw text blobs — conversation turns, code reviews, observations —
that Lore ingests passively and from which it later extracts searchable facts and
knowledge-graph entities. The ingest endpoint must redact secrets before anything
touches the database, deduplicate identical content per agent so retries and
re-sends are idempotent, persist the episode, and kick off fact + graph
extraction without blocking the HTTP response. `POST /api/episode` is that
write-once-extract-async endpoint.

## Interface

Registered as `exact("/api/episode", "POST")`
([registration](../../../apps/lore-api/src/server/build-server.ts#L98)), dispatched by
`handleApiRoute` after the rate-limit + bearer-scope gates.

- **Method + path**: `POST /api/episode`
- **Auth scope**: `write` — `ROUTE_SCOPES["/api/episode"] = "write"`
  ([scope map](../../../apps/lore-api/src/api/routes/memory/episode.ts#L27)). Bearer required;
  `admin` satisfies, `read`-only does not.
- **Rate bucket**: `default` (200/min).

### Request body (JSON)

| Field      | Required | Default     | Notes                                          |
|------------|----------|-------------|------------------------------------------------|
| `content`  | yes      | —           | Raw episode text. Redacted before storage.     |
| `source`   | no       | `"session"` | Provenance label stored on the row.            |
| `ref`      | no       | `null`      | Optional reference (repo, PR, etc.).           |
| `agent_id` | no       | `"unknown"` | Owning agent; part of the dedup key.           |

### Response

- **200** `{ status: "ok", episode_id: <id> }` on a new insert.
- **200** `{ status: "duplicate" }` when the content hash already exists for the
  agent.
- **400** `{ error: "content required" }` when `content` is absent.
- **401 / 403** from the auth gate.
- **500** `{ error: <err.message> }` on JSON parse error or a thrown insert.

## Behavior

Numbered control flow of `handleEpisode(req, res, pool)`:

1. `readBody(req)` → body string.
2. `JSON.parse(body)` inside a `try`; destructure `content, source, ref,
   agent_id`. A parse failure → `catch` → `json(res, 500, { error: err.message
   })`.
3. **Required guard** — if `content` is falsy, `json(res, 400, { error: "content
   required" })` and return.
4. Resolve `agent = agent_id || 'unknown'`.
5. **Redact** — `safeContent = sanitizeContent(content)` (imported as the alias
   of `redactSecrets` from `@re-cinq/lore-shared`): strips API keys, JWTs, private
   keys, connection strings, bearer tokens before anything persists.
6. **Hash** — `contentHash = sha256(safeContent)` (hex) — the dedup key.
7. **Insert** — `INSERT INTO memory.episodes (agent_id, content, content_hash,
   source, ref) VALUES (...) ON CONFLICT (agent_id, content_hash) DO NOTHING
   RETURNING id` with `[agent, safeContent, contentHash, source || 'session', ref
   || null]`. The unique constraint on `(agent_id, content_hash)` makes the
   endpoint idempotent.
8. **Duplicate branch** — if `rows.length === 0` (conflict, nothing inserted),
   `json(res, 200, { status: "duplicate" })` and return.
9. **Async fact extraction** — fire-and-forget
   `extractFactsFromEpisode(rows[0].id, safeContent, agent, pool!).catch(() => {})`
   — its rejection is swallowed and never affects the response.
10. **Async graph extraction** — `gLlm = makeGraphLlmCall(pool)`. The helper
    returns `undefined` when `ANTHROPIC_API_KEY` is unset, gating graph
    extraction on credentials. When defined, fire-and-forget
    `extractAndUpdateGraph(pool!, safeContent, ref || null, rows[0].id, null,
    gLlm).catch(() => {})`.
11. Respond `json(res, 200, { status: "ok", episode_id: rows[0].id })`.

Both extraction calls run after the response is composed and their promises are
not awaited; the route returns 200 regardless of their eventual outcome.

## Output

| Branch                              | Status | Body (verbatim)                              |
|-------------------------------------|--------|----------------------------------------------|
| New episode inserted                | 200    | `{ "status": "ok", "episode_id": <id> }`     |
| Duplicate (hash conflict)           | 200    | `{ "status": "duplicate" }`                   |
| `content` missing                   | 400    | `{ "error": "content required" }`            |
| JSON parse error / insert throws    | 500    | `{ "error": <err.message> }`                 |
| no bearer token (auth gate)         | 401    | `{ "error": "unauthorized" }`                |
| token without `write` scope (gate)  | 403    | `{ "error": "insufficient scope" }`          |

## Dependencies & side effects

- **Redaction**: `redactSecrets` (aliased `sanitizeContent`) from
  `@re-cinq/lore-shared`.
- **Hashing**: `node:crypto` `createHash("sha256")`.
- **DB table**: `memory.episodes` — INSERT with `ON CONFLICT (agent_id,
  content_hash) DO NOTHING`. Requires a non-null `pool` (the handler asserts
  `pool!`).
- **Extraction jobs**: `extractFactsFromEpisode` (`features/memory/facts.ts`),
  `extractAndUpdateGraph` (`features/memory/graph.ts`), both fire-and-forget with
  swallowed rejections. Graph extraction writes `memory.entities` /
  `memory.edges`; facts write `memory.facts`.
- **LLM gate**: `makeGraphLlmCall` (`api/routes/helpers.ts`) returns `undefined`
  unless `ANTHROPIC_API_KEY` is set; the call routes through the shared `Llm`
  singleton (`jobName: "graph-extraction"`).
- **Env**: `ANTHROPIC_API_KEY` (graph-extraction gate), `LORE_INGEST_TOKEN`
  (legacy bearer for the auth gate).

## Acceptance Criteria

A request without `content` returns 400 without touching the DB. ([validated by
`episode.test.ts:59`](apps/lore-api/src/api/routes/memory/episode.test.ts#L59))

A token whose scopes lack `write` is rejected 403 before the handler runs.
([validated by `episode.test.ts:65`](apps/lore-api/src/api/routes/memory/episode.test.ts#L65))

An insert that conflicts (returns no rows) yields `{ status: "duplicate" }`.
([validated by `episode.test.ts:77`](apps/lore-api/src/api/routes/memory/episode.test.ts#L77))

A new episode returns `{ status: "ok", episode_id }`, triggers fact extraction,
and — when `ANTHROPIC_API_KEY` is set — runs the graph LLM closure. ([validated by
`episode.test.ts:86`](apps/lore-api/src/api/routes/memory/episode.test.ts#L86))

With `ANTHROPIC_API_KEY` unset, graph extraction is skipped entirely. ([validated
by `episode.test.ts:113`](apps/lore-api/src/api/routes/memory/episode.test.ts#L113))

A thrown insert returns 500. ([validated by `episode.test.ts:123`](apps/lore-api/src/api/routes/memory/episode.test.ts#L123))

A rejecting fact extraction is swallowed and the response stays 200. ([validated
by `episode.test.ts:132`](apps/lore-api/src/api/routes/memory/episode.test.ts#L132))

A rejecting graph update is swallowed and the response stays 200. ([validated by
`episode.test.ts:145`](apps/lore-api/src/api/routes/memory/episode.test.ts#L145))

The actual fact/entity/edge content produced by the extraction LLM is exercised
only against the live model. *(untested: fact + graph extraction are live-IO LLM
calls; the route seam mocks both and asserts only the trigger/skip/swallow
contract.)*

## Out of Scope

- The fact-extraction and graph-extraction algorithms and their DB writes —
  owned by the memory feature module.
- The redaction ruleset inside `redactSecrets` (shared package).
- Episode lifecycle (decay, consolidation, snapshots).
- Token issuance and the scope schema.

Code: handler [`handleEpisode`](../../../apps/lore-api/src/api/routes/memory/episode.ts#L22)
(IMPLEMENTED_BY); route [registration](../../../apps/lore-api/src/server/build-server.ts#L98).
