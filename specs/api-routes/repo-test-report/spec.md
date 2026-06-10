# Feature Specification: POST /api/repos/:owner/:repo/test-report

| Field      | Value                                                  |
|------------|--------------------------------------------------------|
| Feature    | Repo test-report ingest route                          |
| Status     | **Draft**                                              |
| Created    | 2026-06-10                                             |
| Owner      | Platform Engineering                                   |
| Route      | `POST /api/repos/:owner/:repo/test-report`             |
| Auth scope | `write` (SCOPE_OVERRIDES)                              |
| Module     | `mcp-server/src/api/routes/test-report.ts`             |

## Problem Statement

A project's `tests.list` descriptors plus per-test `tests.run` results are the
deterministic, zero-LLM source of truth for the spec-traceability graph: which
test chunks exist, which tests claim to validate a spec statement
(`validated_by`), which source ranges they cover (`COVERS`), and which
spec-anchored tests are currently failing (`violated`). This route folds the
report body into those graph counts, echoes them, and fires a fire-and-forget
spec-trace projection trigger to the agent with the raw report body.

## Interface

- **Method + path**: `POST /api/repos/:owner/:repo/test-report`
  (regex `^/api/repos/[^/]+/[^/]+/test-report(\?|$)`).
  Implemented by the [route registration](../../../mcp-server/src/api/routes/index.ts#L73)
  dispatching to the [`handleTestReport` handler](../../../mcp-server/src/api/routes/test-report.ts#L35).
- **Auth scope**: `write`. Matched by `SCOPE_OVERRIDES`
  (`/api/repos/[^/]+/[^/]+/test-report(\?|$|/)` → `write`).
- **Rate bucket**: `default` (200/min).

### Request body (`TestReportBody`)

| Field     | Type               | Required | Notes |
|-----------|--------------------|----------|-------|
| `commit`  | string             | yes      | Non-empty; enforced by `requireCommit`. |
| `branch`  | string             | no       | Accepted, not used in counting. |
| `tests`   | `TestDescriptor[]` | no       | `{id,name,file,startLine,endLine,suite?,spec?}`. A `spec` field marks a `validated_by` link. |
| `results` | `TaggedRunResult[]`| no       | `{id,passed,covered:{file,startLine,endLine}[]}`. Keyed back to a test by `id`. |

### Response

`200 application/json` with `TestReportCounts`:

```
{ tests_seen, test_chunks, validated_by, coverage_nodes, covers_edges, violated }
```

`400 application/json` `{ error: string }` on missing commit.

## Behavior

1. Dispatcher gates: rate-limit (`default`), then bearer auth —
   `getRequiredScope(url)` returns `write`. Missing token → 401; insufficient
   scope → 403.
2. `readJsonBody(req)` parses the body.
3. `requireCommit(body, res)` — missing/empty `commit` → write
   `400 { error: "required: commit" }` and return.
4. **Fan-out** — `repoFromReposUrl(req.url)` resolves `owner/name`; on a match,
   `triggerAgentSpecTrace(repo, "test-report", body)` fires (`void`) with the
   **raw** body. No-ops when the agent env is unset.
5. **Counting** (`countReport`) — with `tests = body.tests ?? []`,
   `results = body.results ?? []`, and a `Map<id, result>`:
   - `tests_seen` = `test_chunks` = `tests.length`.
   - `validated_by` = count of tests with a truthy `spec`.
   - `coverage_nodes` = `results.length`.
   - `covers_edges` = sum of `result.covered.length` over all results.
   - `violated` = count of tests that have a `spec` **and** whose matching
     result (`resultById.get(test.id)`) has `passed === false`.
   Write `200` with the counts.

The handler never touches `_pool` — deferred Dgraph projection seam.

## Output

| Condition | Status | Body |
|-----------|--------|------|
| Missing/empty `commit` | 400 | `{ "error": "required: commit" }` |
| Success | 200 | `{ tests_seen, test_chunks, validated_by, coverage_nodes, covers_edges, violated }` |
| No bearer token | 401 | `{ "error": "unauthorized" }` (dispatcher) |
| Token lacks `write` | 403 | `{ "error": "insufficient scope" }` (dispatcher) |

## Dependencies & side effects

- Handler `handleTestReport`; pure `countReport`.
- `triggerAgentSpecTrace` fire-and-forget POST to `/api/trigger/spec-trace`.
- Env: `LORE_AGENT_URL`, `LORE_AGENT_INTERNAL_TOKEN` (fan-out); `LORE_INGEST_TOKEN` (legacy auth).
- No DB write, no Dgraph call.

## Acceptance Criteria

A report with two tests (one spec-anchored) and two passing results yields the
correct chunk/validated/coverage/edge counts with `violated = 0`. ([validated by `returns 200 with counts derived from tests and results`](../../../mcp-server/src/api/routes/test-report.test.ts#L17))

Only a failing spec-anchored test increments `violated`; a failing
non-anchored test does not. ([validated by `returns violated 1 when only the spec-anchored test fails`](../../../mcp-server/src/api/routes/test-report.test.ts#L51))

The spec-trace trigger fires with the raw report body when the agent env is
configured. ([validated by `fires the spec-trace trigger with the report body when the agent env is configured`](../../../mcp-server/src/api/routes/test-report.test.ts#L75))

A missing `commit` is rejected with 400. ([validated by `returns 400 when commit is missing`](../../../mcp-server/src/api/routes/test-report.test.ts#L105))

The fan-out forwarder POSTs `{repo, kind, payload}` to `/api/trigger/spec-trace`
with the bearer token. ([validated by `POSTs repo, kind, and payload to /api/trigger/spec-trace with the bearer token`](../../../mcp-server/src/api/routes/spec-trace-trigger.test.ts#L18))

## Out of Scope

- Dgraph projection of `TestChunk` / `Coverage` / `VALIDATED_BY` / `COVERS` and
  `commit`-keyed idempotency — deferred to `spec-traceability-graph`.
- The agent-side `/api/trigger/spec-trace` consumer.
- Coverage-format parsing (LCOV/Cobertura) — owned by [`repo-coverage`](../repo-coverage/spec.md).
