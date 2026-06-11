# Feature Specification: POST /api/ingest

| Field      | Value                                          |
|------------|------------------------------------------------|
| Feature    | Ingest files HTTP route                        |
| Status     | **Draft**                                       |
| Created    | 2026-06-10                                      |
| Owner      | Platform Engineering                           |
| Route      | `POST /api/ingest`                             |
| Auth scope | `write`                                         |
| Module     | `mcp-server/src/api/routes/ingest.ts` (`handleIngest`) |

## Problem Statement

Repo content (docs, ADRs, specs, source files) must be chunked, embedded, and
written into the per-team vector store so that context assembly and search can
retrieve it. Callers — the nightly ingestion job, the `lore_ingest_files` MCP tool,
and CI — need a single authenticated endpoint that accepts a batch of files for
one repo at one commit, persists them, and reports per-file outcomes. After a
batch lands, downstream graph re-projection and spec→test re-linking must be
kicked off without blocking the response.

## Interface

- **Method + path**: `POST /api/ingest`
- **Auth**: bearer token with `write` scope. Resolved by `getRequiredScope`
  matching the `/api/ingest` prefix → `write` in the `ROUTE_SCOPES` table; the
  legacy `LORE_INGEST_TOKEN` is full-access. Missing bearer → 401; insufficient
  scope → 403 (both written by the dispatcher before the handler runs).

### Request

JSON body:

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `files` | array | yes | — | Array of path strings or `{path, content}` objects. Must be an array. |
| `repo` | string | yes | — | `owner/name`. Truthy check only (not slash-validated here). |
| `commit` | string | no | `"HEAD"` | Commit the batch belongs to; used by the content-hash gate. |

### Response

| Status | Body |
|--------|------|
| 200 | The `ingestFiles` result object, e.g. `{ results: [{ status, … }], … }`. |
| 400 | `{ "error": "required: files (array of paths or {path,content}), repo (string)" }` |
| 500 | `{ "error": "<err.message>" }` (JSON parse failure or `ingestFiles` throw). |
| 503 | `{ "error": "database not available" }` (pool is null). |

## Behavior

1. If `pool` is null → 503 `{ error: "database not available" }`; return.
2. Read the raw request body via `readBody`.
3. `JSON.parse(body)` inside a try; any throw (bad JSON or downstream error) is
   caught at step 9.
4. Destructure `{ files, repo, commit }`. If `files` is not an array **or**
   `repo` is falsy → 400 with the verbatim required-fields error; return.
5. `await ingestFiles(pool, files, repo, commit || "HEAD")`
   ([engine](../../../mcp-server/src/features/spec-trace/ingest.js)).
6. Write 200 with the `result` object.
7. **Landed gate** — compute `landed`: true iff `result.results` is an array and
   at least one entry has `status === "ingested"` or `status === "deleted"`.
   A missing/non-array `results` → `landed = false`.
8. **Fan-out (fire-and-forget, only when `landed`)**:
   - `void triggerAgentSpecCoverageValidate(repo)` — POSTs `{repo}` to the agent
     at `${LORE_AGENT_URL}/api/trigger/spec-coverage-validate` with
     `Authorization: Bearer ${LORE_AGENT_INTERNAL_TOKEN}`. No-op (warn) when
     either env var is unset.
   - `void maybeAutoIngestGraph(pool, repo)` — re-projects the spec-traceability
     graph, gated on the repo's `settings.auto_ingest_graph` opt-in.
   Both run after the 200 has already been written.
9. **Catch** — log `[ingest] API error: <message>` and write 500
   `{ error: err.message }`.

## Output

- **Success**: 200, body = the `ingestFiles` result (shape owned by the ingest
  engine). Fan-out triggers fire asynchronously after the response.
- **Validation failure**: 400, `{ error: "required: files (array of paths or {path,content}), repo (string)" }`.
- **Engine / parse error**: 500, `{ error: "<message>" }`.
- **No DB**: 503, `{ error: "database not available" }`.

## Dependencies & side effects

- `ingestFiles` (`features/spec-trace/ingest.ts`) — chunk/embed/persist; reads &
  writes `{team_schema}.chunks` (and `org_shared.chunks`).
- `triggerAgentSpecCoverageValidate` (`routes/helpers.ts`) — fan-out HTTP POST to
  the agent service.
- `maybeAutoIngestGraph` (`features/spec-trace/ingest-graph-tasks.ts`) — creates
  `ingest-<kind>` pipeline tasks in `pipeline.tasks` when opted in.
- Env: `LORE_AGENT_URL`, `LORE_AGENT_INTERNAL_TOKEN` (fan-out only); auth env
  `LORE_INGEST_TOKEN`, `pipeline.api_tokens` (dispatcher).

## Acceptance Criteria

A null pool returns 503 before any parsing. ([validated by `returns 503 when pool is null`](../../../mcp-server/src/api/routes/ingest.test.ts#L25))

A body whose `files` is not an array returns 400. ([validated by `returns 400 when files is not an array`](../../../mcp-server/src/api/routes/ingest.test.ts#L31))

A body missing `repo` returns 400 with the verbatim required-fields error. ([validated by `returns 400 when repo is missing`](../../../mcp-server/src/api/routes/ingest.test.ts#L56))

A batch with an ingested file returns 200 and fires the spec-coverage-validate trigger. ([validated by `returns 200 and fires the spec-coverage trigger when a file lands`](../../../mcp-server/src/api/routes/ingest.test.ts#L38))

A landed batch also fires the graph auto-ingest fan-out with the pool and repo. ([validated by `fires the graph auto-ingest fan-out when a file lands`](../../../mcp-server/src/api/routes/ingest.test.ts#L64))

A `deleted` status counts as a landed file and fires the trigger. ([validated by `treats a deleted status as a landed file and fires the trigger`](../../../mcp-server/src/api/routes/ingest.test.ts#L79))

An all-skipped batch fires neither the graph fan-out nor the trigger. ([validated by `does not fire the graph fan-out when nothing landed`](../../../mcp-server/src/api/routes/ingest.test.ts#L96)) ([validated by `does not fire the trigger when nothing landed`](../../../mcp-server/src/api/routes/ingest.test.ts#L111))

A result with no `results` array fires no trigger. ([validated by `does not fire the trigger when the result has no results array`](../../../mcp-server/src/api/routes/ingest.test.ts#L127))

A throwing `ingestFiles` returns 500 with the error message. ([validated by `returns 500 when ingestFiles throws`](../../../mcp-server/src/api/routes/ingest.test.ts#L143))

The route is registered as an exact `POST /api/ingest` match. ([implemented by](../../../mcp-server/src/api/routes/index.ts#L53)) ([implemented by](../../../mcp-server/src/api/routes/ingest.ts#L9))

## Out of Scope

- The chunking/embedding/persistence engine internals (`ingestFiles`).
- The spec-traceability graph projection (`maybeAutoIngestGraph` downstream task).
- The agent-side spec-coverage-validate pass.
- Bearer-token validation mechanics (owned by `auth.ts`).
