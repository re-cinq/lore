# Feature Specification: POST /api/session-summary HTTP Route

| Field      | Value                                                            |
|------------|------------------------------------------------------------------|
| Feature    | POST /api/session-summary HTTP Route                             |
| Status     | **Draft**                                                        |
| Created    | 2026-06-10                                                       |
| Owner      | Platform Engineering                                            |
| Route      | `POST /api/session-summary`                                      |
| Auth scope | `write`                                                          |
| Module     | Memory routes (`api/routes/memory.ts` → `handleSessionSummary`) |

## Problem Statement

When a Claude Code session ends, the Stop hook POSTs the captured session log so
Lore can passively turn it into an episode and extract facts + graph entities —
no agent cooperation required. The session log arrives as either a plain string
or a structured object (with or without a `summary` field), may be effectively
empty, and must be normalized, framed with the originating repo, deduplicated,
and persisted before async extraction fires. `POST /api/session-summary` is the
session-hook ingest endpoint: a sibling of `/api/episode` specialized for the
hook's payload shape and its skip/duplicate semantics.

## Interface

Registered as `exact("/api/session-summary", "POST")`
([registration](../../../apps/mcp-server/src/api/routes/index.ts#L63)), dispatched by
`handleApiRoute` after the rate-limit + bearer-scope gates.

- **Method + path**: `POST /api/session-summary`
- **Auth scope**: `write` — `ROUTE_SCOPES["/api/session-summary"] = "write"`
  ([scope map](../../../apps/mcp-server/src/api/routes/auth.ts#L46)). Bearer required;
  `admin` satisfies, `read`-only does not.
- **Rate bucket**: `default` (200/min).

### Request body (JSON)

| Field         | Required | Default          | Notes                                                  |
|---------------|----------|------------------|--------------------------------------------------------|
| `session_log` | yes      | —                | String, or object with optional `.summary` field.      |
| `repo`        | no       | `"unknown"`/null | Frames the episode content; stored as `ref`.           |
| `agent_id`    | no       | `"session-hook"` | Owning agent; part of the dedup key.                   |

### Response

- **200** `{ status: "ok", episode_id: <id> }` on a new insert.
- **200** `{ status: "skipped", reason: "empty session" }` when the normalized
  summary is shorter than 10 chars.
- **200** `{ status: "duplicate" }` when the content hash already exists for the
  agent.
- **400** `{ error: "required: session_log" }` when `session_log` is absent.
- **503** `{ error: "database not available" }` when `pool` is null.
- **401 / 403** from the auth gate.
- **500** `{ error: <err.message> }` on JSON parse error or a thrown insert.

## Behavior

Numbered control flow of `handleSessionSummary(req, res, pool)`:

1. `readBody(req)` → body string.
2. `JSON.parse(body)` inside a `try`; destructure `session_log, repo, agent_id`.
   Parse failure → `catch` → `json(res, 500, { error: err.message })`.
3. **Required guard** — if `session_log` is falsy, `json(res, 400, { error:
   "required: session_log" })` and return.
4. **Normalize summary** — if `session_log` is a string, `summary =
   session_log`; otherwise `summary = session_log.summary || JSON.stringify(
   session_log)` (object with `.summary` uses it; without, stringify the whole
   object).
5. **Empty-session skip** — if `!summary || summary.length < 10`, `json(res, 200,
   { status: "skipped", reason: "empty session" })` and return.
6. **Frame content** — `content = \`Session in ${repo || "unknown"}\n\n${summary}\``.
7. Resolve `agent = agent_id || "session-hook"`.
8. **Hash** — `contentHash = sha256(content)` (hex). Note: unlike `/api/episode`,
   the content is **not** passed through `redactSecrets` here.
9. **DB-availability gate** — if `!pool`, `json(res, 503, { error: "database not
   available" })` and return. (This is checked after normalization, so an empty
   session skips with 200 even when the DB is down.)
10. **Insert** — `INSERT INTO memory.episodes (agent_id, content, content_hash,
    source, ref) VALUES ($1, $2, $3, 'session', $4) ON CONFLICT (agent_id,
    content_hash) DO NOTHING RETURNING id` with `[agent, content, contentHash,
    repo || null]`. `source` is the literal `'session'`.
11. **Duplicate branch** — if `rows.length === 0`, `json(res, 200, { status:
    "duplicate" })` and return.
12. **Async fact extraction** — fire-and-forget `extractFactsFromEpisode(
    rows[0].id, content, agent, pool).catch(() => {})`.
13. **Async graph extraction** — `gLlm = makeGraphLlmCall(pool)` (undefined
    without `ANTHROPIC_API_KEY`). When defined, fire-and-forget
    `extractAndUpdateGraph(pool, content, repo || null, rows[0].id, null,
    gLlm).catch(() => {})`.
14. Respond `json(res, 200, { status: "ok", episode_id: rows[0].id })`.

## Output

| Branch                                | Status | Body (verbatim)                                          |
|---------------------------------------|--------|----------------------------------------------------------|
| New episode inserted                  | 200    | `{ "status": "ok", "episode_id": <id> }`                 |
| Normalized summary < 10 chars         | 200    | `{ "status": "skipped", "reason": "empty session" }`     |
| Duplicate (hash conflict)             | 200    | `{ "status": "duplicate" }`                               |
| `session_log` missing                 | 400    | `{ "error": "required: session_log" }`                   |
| `pool` is null                        | 503    | `{ "error": "database not available" }`                  |
| JSON parse error / insert throws      | 500    | `{ "error": <err.message> }`                             |
| no bearer token (auth gate)           | 401    | `{ "error": "unauthorized" }`                            |
| token without `write` scope (gate)    | 403    | `{ "error": "insufficient scope" }`                      |

## Dependencies & side effects

- **Hashing**: `node:crypto` `createHash("sha256")`. (No redaction on this route.)
- **DB table**: `memory.episodes` — INSERT with `ON CONFLICT (agent_id,
  content_hash) DO NOTHING`, `source` hardcoded `'session'`. Null `pool` → 503.
- **Extraction jobs**: `extractFactsFromEpisode` (`features/memory/facts.ts`),
  `extractAndUpdateGraph` (`features/memory/graph.ts`), both fire-and-forget with
  swallowed rejections.
- **LLM gate**: `makeGraphLlmCall` (`api/routes/helpers.ts`) — `undefined`
  without `ANTHROPIC_API_KEY`.
- **Env**: `ANTHROPIC_API_KEY` (graph-extraction gate), `LORE_INGEST_TOKEN`
  (legacy bearer for the auth gate).

## Acceptance Criteria

A request without `session_log` returns 400. ([validated by `returns 400 when
session_log is missing`](apps/lore-api/src/api/routes/memory/session-summary.test.ts#L47))

A token whose scopes lack `write` is rejected 403 before the handler runs.
([validated by `returns 403 when the token lacks write scope`](apps/lore-api/src/api/routes/memory/session-summary.test.ts#L53))

A string summary shorter than 10 chars is skipped with `{ status: "skipped",
reason: "empty session" }`. ([validated by `skips when the string summary is too
short`](apps/lore-api/src/api/routes/memory/session-summary.test.ts#L65))

An object `session_log` with a `.summary` field uses that field. ([validated by
`uses the object .summary field`](apps/lore-api/src/api/routes/memory/session-summary.test.ts#L53))

An object without `.summary` falls back to `JSON.stringify`. ([validated by
`falls back to JSON.stringify for objects without a summary`](apps/lore-api/src/api/routes/memory/session-summary.test.ts#L83))

A null pool returns 503. ([validated by `returns 503 when pool is null`](apps/lore-api/src/api/routes/memory/session-summary.test.ts#L95))

An insert that conflicts yields `{ status: "duplicate" }`. ([validated by
`returns duplicate when the insert conflicts`](apps/lore-api/src/api/routes/memory/session-summary.test.ts#L101))

A thrown insert returns 500. ([validated by `returns 500 when the insert
throws`](apps/lore-api/src/api/routes/memory/session-summary.test.ts#L110))

A rejecting fact extraction is swallowed and the response stays 200. ([validated
by `swallows a failing session fact extraction`](apps/lore-api/src/api/routes/memory/session-summary.test.ts#L119))

With `ANTHROPIC_API_KEY` set, graph extraction runs and a rejection is swallowed.
([validated by `runs and swallows graph extraction when ANTHROPIC_API_KEY is
set`](apps/lore-api/src/api/routes/memory/session-summary.test.ts#L135))

The fact/entity/edge content produced by extraction is exercised only against the
live model. *(untested: fact + graph extraction are live-IO LLM calls; the route
seam mocks both and asserts only the trigger/skip/swallow contract.)*

## Out of Scope

- The fact-extraction and graph-extraction algorithms and their DB writes.
- The Stop-hook capture that produces the `session_log` payload.
- Episode lifecycle (decay, consolidation).
- Token issuance and the scope schema.

Code: handler [`handleSessionSummary`](../../../apps/mcp-server/src/api/routes/memory.ts#L89)
(IMPLEMENTED_BY); route [registration](../../../apps/mcp-server/src/api/routes/index.ts#L63).
