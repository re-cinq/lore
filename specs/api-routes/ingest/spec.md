# Feature Specification: POST /api/ingest

| Field      | Value                                          |
|------------|------------------------------------------------|
| Feature    | Ingest files HTTP route                        |
| Status     | In Progress                                     |
| Created    | 2026-06-10                                      |
| Owner      | Platform Engineering                           |
| Route      | `POST /api/ingest`                             |
| Auth scope | `write`                                         |
| Module     | `mcp-server/src/api/routes/ingest.ts` (`handleIngest`) |

POST /api/ingest chunks, embeds, and writes a batch of a repo's files at a given commit into the per-team vector store, reports per-file outcomes, and asynchronously triggers spec-coverage re-validation once a batch lands.

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
   ([engine](../../../apps/mcp-server/src/features/spec-trace/ingest.js)).
6. Write 200 with the `result` object.
7. **Landed gate** — compute `landed`: true iff `result.results` is an array and
   at least one entry has `status === "ingested"` or `status === "deleted"`.
   A missing/non-array `results` → `landed = false`.
8. **Fan-out (fire-and-forget, only when `landed`)**:
   - `void triggerAgentSpecCoverageValidate(repo)` — POSTs `{repo}` to the agent
     at `${LORE_AGENT_URL}/api/trigger/spec-coverage-validate` with
     `Authorization: Bearer ${LORE_AGENT_INTERNAL_TOKEN}`. No-op (warn) when
     either env var is unset.
   This runs after the 200 has already been written. **Spec/ADR graph
   re-projection is no longer fired here** — it is CI-driven via the repo's
   `lore-ingest.yml` (per-kind jobs POST to `/api/repos/:o/:r/ingest-graph`,
   which fires the spec-trace trigger; see [ADR-023](../../../adrs/ADR-023-test-run-trace-binding.md)).
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
- Env: `LORE_AGENT_URL`, `LORE_AGENT_INTERNAL_TOKEN` (fan-out only); auth env
  `LORE_INGEST_TOKEN`, `pipeline.api_tokens` (dispatcher).

## Acceptance Criteria

A null pool returns 503 before any parsing. ([validated by `returns 503 when pool is null`](apps/lore-api/src/api/routes/ingest/ingest.test.ts#L42))

A body whose `files` is not an array returns 400. ([validated by `returns 400 when files is not an array`](apps/lore-api/src/api/routes/ingest/ingest.test.ts#L49))

A body missing `repo` returns 400 with the verbatim required-fields error. ([validated by `returns 400 when repo is missing`](apps/lore-api/src/api/routes/ingest/ingest.test.ts#L68))

A batch with an ingested file returns 200 and fires the spec-coverage-validate trigger. ([validated by `returns 200 and inserts a spec-coverage-validate event when a file lands`](apps/lore-api/src/api/routes/ingest/ingest.test.ts#L55))

A `deleted` status counts as a landed file and fires the trigger. ([validated by `treats a deleted status as a landed file and inserts the event`](apps/lore-api/src/api/routes/ingest/ingest.test.ts#L74))

An all-skipped batch fires no trigger. ([validated by `does not insert an event when nothing landed`](apps/lore-api/src/api/routes/ingest/ingest.test.ts#L87))

A result with no `results` array fires no trigger. ([validated by `does not fire the trigger when the result has no results array`](apps/lore-api/src/api/routes/ingest/ingest.test.ts#L97))

A throwing `ingestFiles` returns 500 with the error message. ([validated by `returns 500 when ingestFiles throws`](apps/lore-api/src/api/routes/ingest/ingest.test.ts#L108))

The post-200 spec-coverage-validate fan-out is resilient: it is a no-op when there is no pool and swallows insert errors so a flaky DB never breaks the already-written ingest response. ([validated by `spec-coverage-validate-trigger.test.ts:32`](apps/lore-api/src/api/routes/spec-coverage-validate-trigger.test.ts#L32), [validated by `spec-coverage-validate-trigger.test.ts:38`](apps/lore-api/src/api/routes/spec-coverage-validate-trigger.test.ts#L38))

The route is registered as an exact `POST /api/ingest` match. ([implemented by](../../../apps/lore-api/src/server/build-server.ts#L100), [implemented by](../../../apps/lore-api/src/api/routes/ingest/ingest.ts#L21))

A `files` entry may be a bare path string or a `{path, content}` object; the two are distinguished by type and the path is extracted from either form. ([validated by IngestFile distinguishes path strings from content objects](apps/lore-api/src/features/spec-trace/ingest.test.ts#L53), [`ingest.test.ts:62`](apps/lore-api/src/features/spec-trace/ingest.test.ts#L62))

When the supplied `commit` belongs to a different repo than the one being fetched, content resolution falls back to `HEAD`; a matching repo keeps the specific commit, and the fetch retries refs in order (specific commit, then `HEAD`) without duplicating `HEAD` when the commit is already `HEAD`. ([validated by commit SHA fallback uses HEAD when commit is from a different repo](apps/lore-api/src/features/spec-trace/ingest.test.ts#L81), [`ingest.test.ts:91`](apps/lore-api/src/features/spec-trace/ingest.test.ts#L91), [`ingest.test.ts:101`](apps/lore-api/src/features/spec-trace/ingest.test.ts#L101), [`ingest.test.ts:108`](apps/lore-api/src/features/spec-trace/ingest.test.ts#L108))

## Out of Scope

- The chunking/embedding/persistence engine internals (`ingestFiles`).
- The spec-traceability graph projection — CI-driven via `/api/repos/:o/:r/ingest-graph`
  and the spec-trace trigger (ADR-023), not this route.
- The agent-side spec-coverage-validate pass.
- Bearer-token validation mechanics (owned by `auth.ts`).
