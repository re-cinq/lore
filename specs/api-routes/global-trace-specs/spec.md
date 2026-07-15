# Feature Specification: GET /api/trace/specs

| Field      | Value                                                  |
|------------|--------------------------------------------------------|
| Feature    | Global cross-repo spec list route                      |
| Status     | **Draft**                                              |
| Created    | 2026-06-10                                             |
| Owner      | Platform Engineering                                   |
| Route      | `GET /api/trace/specs`                                 |
| Auth scope | `read` (default)                                       |
| Module     | `mcp-server/src/api/routes/trace.ts`                   |

## Problem Statement

The global spec viewer needs every spec document across **all** repos, not just
one. This is a cross-repo read, so it does not go through the per-repo `Project`
facade; it queries the spec-traceability Dgraph directly for the list of all
spec documents. Like the per-repo trace reads, it must fail soft to an empty
list when Dgraph is unconfigured (the shared-server default) so the UI renders
an empty viewer rather than an error.

## Interface

- **Method + path**: `GET /api/trace/specs`
  (regex `^/api/trace/specs(\?|$)`).
  Implemented by the [route registration](../../../apps/mcp-server/src/api/routes/index.ts#L76)
  dispatching to the [`handleGlobalTraceSpecs` handler](../../../apps/mcp-server/src/api/routes/trace.ts#L8).
- **Auth scope**: `read` (the default — no `SCOPE_OVERRIDES` or `ROUTE_SCOPES`
  entry matches `/api/trace/specs`).
- **Rate bucket**: `default` (200/min).
- **Query/body**: none.

### Response

`200 application/json` `{ specs: Array<{ repo: string; filePath: string }> }`
(empty array when Dgraph is unconfigured).

`500 application/json` `{ error: string }` on a Dgraph query error.

## Behavior

1. Dispatcher gates: rate-limit (`default`), then bearer auth —
   `getRequiredScope("/api/trace/specs")` returns `read`. Missing token → 401;
   insufficient scope → 403.
2. `createDgraphClient(process.env)` — returns `null` when `LORE_DGRAPH_HTTP`
   is unset. On `null`, write `200 { specs: [] }` (fail-soft, no error).
3. Otherwise `await listAllSpecDocuments(dgraph)` — the cross-repo DQL query
   returning every spec document's `{ repo, filePath }`. Write `200 { specs }`.
4. A thrown query error is caught → write `500 { error: <message> }`.

The handler ignores `_pool` — the cross-repo list lives in Dgraph.

## Output

| Condition | Status | Body |
|-----------|--------|------|
| Dgraph unset | 200 | `{ "specs": [] }` |
| Dgraph hit (live) | 200 | `{ "specs": [{ repo, filePath }, …] }` |
| Dgraph query error | 500 | `{ "error": "<message>" }` |
| No bearer token | 401 | `{ "error": "unauthorized" }` (dispatcher) |
| Token lacks `read` | 403 | `{ "error": "insufficient scope" }` (dispatcher) |

## Dependencies & side effects

- Handler `handleGlobalTraceSpecs`.
- `@re-cinq/lore-shared`: `createDgraphClient`, `listAllSpecDocuments`.
- Dgraph via `LORE_DGRAPH_HTTP` (absent → fail-soft empty list).
- Env: `LORE_DGRAPH_HTTP`; `LORE_INGEST_TOKEN` (legacy auth).
- Read-only; no fan-out, no DB write.

## Acceptance Criteria

With Dgraph unconfigured, the route fails soft to `200 { specs: [] }` — never a
500. ([validated by `returns 200 with an empty specs list when Dgraph is not configured`](apps/lore-api/src/api/routes/trace/trace.test.ts#L71))

A request without a bearer token is rejected with 401 before the handler runs.
([validated by `returns 401 without a bearer token`](apps/lore-api/src/api/routes/trace/trace.test.ts#L78))

The live `listAllSpecDocuments` success body and the `500` query-error branch
need a live Dgraph backend. *(untested: both require `LORE_DGRAPH_HTTP` pointed
at a populated Dgraph; only the null-client fail-soft is reachable in the unit
harness.)*

## Out of Scope

- The `listAllSpecDocuments` cross-repo DQL — owned by `shared/src/spec-trace/assemble-trace-document.ts`.
- Per-repo trace reads — owned by [`repo-trace`](../repo-trace/spec.md).
- The deferred Dgraph projection that populates the graph.
