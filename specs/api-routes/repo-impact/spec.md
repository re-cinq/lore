# Feature Specification: POST /api/repos/:owner/:repo/impact

| Field      | Value                                                  |
|------------|--------------------------------------------------------|
| Feature    | Repo pre-merge spec-impact query route                 |
| Status     | **Draft**                                              |
| Created    | 2026-06-10                                             |
| Owner      | Platform Engineering                                   |
| Route      | `POST /api/repos/:owner/:repo/impact`                  |
| Auth scope | `write` (SCOPE_OVERRIDES)                              |
| Module     | `mcp-server/src/api/routes/impact.ts`                  |

## Problem Statement

Before a PR merges, an advisory GitHub Action needs to know which spec
statements the diff couples to and which it orphans (deletes the only coverage
for). This must be a deterministic, zero-LLM graph read that **never** red-Xes
the PR: when the spec-traceability graph is unreachable the route degrades to a
neutral "unavailable" result, not an error. The route walks the graph for the
diff's changed ranges and returns the `ImpactReport` plus pre-shaped Checks-API
`annotations[]` and a markdown `comment` the Action renders verbatim.

## Interface

- **Method + path**: `POST /api/repos/:owner/:repo/impact`
  (regex `^/api/repos/[^/]+/[^/]+/impact(\?|$)`).
  Implemented by the [route registration](../../../apps/mcp-server/src/api/routes/index.ts#L74)
  dispatching to the [`handleImpactRoute` handler](../../../apps/mcp-server/src/api/routes/impact.ts#L35).
- **Auth scope**: `write`. Matched by `SCOPE_OVERRIDES`
  (`/api/repos/[^/]+/[^/]+/impact(\?|$|/)` → `write`). The write scope reflects
  the privileged ingest surface, **not** test execution — a graph read is not
  gated by the trust boundary that forbids running tests on the shared server.
- **Rate bucket**: `default` (200/min).

### Request body (`ImpactBody`)

| Field    | Type             | Required | Notes |
|----------|------------------|----------|-------|
| `commit` | string           | no       | Diff head (informational). |
| `base`   | string           | no       | Diff base (informational). |
| `files`  | `ChangedRange[]` | no       | `{ path, ranges: [number,number][], deleted?: [number,number][] }`. Non-array → treated as `[]`. |

`ranges` are new/modified intervals (coupling); `deleted` are removed old-side
intervals (orphan detection).

### Response

`200 application/json`: `{ ...ImpactReport, annotations, comment }` where
`ImpactReport` is `{ status, statements, orphaned, testSelectors, graphCommit?, stale? }`.

`400 application/json` `{ error: "could not resolve repo from url" }` if the
URL does not yield `owner/repo`.

## Behavior

1. Dispatcher gates: rate-limit (`default`), then bearer auth —
   `getRequiredScope(url)` returns `write`. Missing token → 401; insufficient
   scope → 403.
2. `repoFromReposUrl(req.url)` resolves `owner/name`; on no match, write
   `400 { error: "could not resolve repo from url" }` and return.
3. `readJsonBody(req)` parses the body; `files = Array.isArray(body.files) ? body.files : []`.
4. **`safeComputeImpact(repo, files)`** — the fail-soft core:
   1. `createDgraphClient(process.env)` — returns `null` when `LORE_DGRAPH_HTTP`
      is unset (the shared-server default). On `null`, return the module
      constant `UNAVAILABLE = { status:"unavailable", statements:[], orphaned:[], testSelectors:[] }`.
      This is the **expected** fail-soft and logs nothing.
   2. Otherwise `await computeImpact(dgraph, repo, files)` — walks the
      spec-traceability graph: CodeChunk overlap → `~Statement.implemented_by`
      and Coverage-facet overlap → TestChunk → `~Statement.validated_by` for
      coupled statements; statements whose only coverage the diff `deleted` →
      `orphaned`. Returns `{ status:"ok", statements, orphaned, testSelectors }`.
   3. A thrown error (reachable Dgraph, broken DQL / missing schema) is caught,
      logged with context (`[impact] query failed for <repo> (Dgraph reachable
      but errored): <stack>`), and degraded to `UNAVAILABLE` — never a 500.
5. **Shaping** — `annotations = report.status === "ok" ? buildImpactAnnotations(report, files) : []`
   (empty on `unavailable`); `comment = buildImpactComment(report)` (the
   markdown the Action posts, including the neutral skip text on `unavailable`).
6. Write `200 { ...report, annotations, comment }`.

The handler never touches `_pool` — the graph lives in Dgraph, not Postgres.

## Output

| Condition | Status | Body |
|-----------|--------|------|
| URL has no repo slug | 400 | `{ "error": "could not resolve repo from url" }` |
| Dgraph unset / query error | 200 | `{ status:"unavailable", statements:[], orphaned:[], testSelectors:[], annotations:[], comment }` |
| Graph hit (live Dgraph) | 200 | `{ status:"ok", statements:[…], orphaned:[…], testSelectors:[…], annotations:[…], comment }` |
| No bearer token | 401 | `{ "error": "unauthorized" }` (dispatcher) |
| Token lacks `write` | 403 | `{ "error": "insufficient scope" }` (dispatcher) |

## Dependencies & side effects

- Handler `handleImpactRoute`; `safeComputeImpact` wrapper.
- `@re-cinq/lore-shared`: `createDgraphClient`, `computeImpact`,
  `buildImpactAnnotations`, `buildImpactComment`.
- Dgraph via `LORE_DGRAPH_HTTP` (absent on the shared server → fail-soft).
- Env: `LORE_DGRAPH_HTTP`; `LORE_INGEST_TOKEN` (legacy auth).
- No DB write, no agent fan-out. Read-only.

## Acceptance Criteria

With Dgraph unconfigured, the route fails soft to `200` with
`status:"unavailable"` and empty statements/orphaned/annotations — never a 500.
([validated by `returns 200 status unavailable with empty annotations when Dgraph is not configured`](apps/lore-api/src/api/routes/impact/impact-route.test.ts#L36))

A request without a `write`-scoped token is rejected with 403. ([validated by `rejects a request without a write-scoped token`](apps/lore-api/src/api/routes/impact/impact-route.test.ts#L51))

The `status:"ok"` branch (coupled statements + orphans + non-empty annotations
from a live graph walk) is exercised only against live Dgraph. *(untested: the
`computeImpact` graph walk needs a populated Dgraph backend; only the null-client
fail-soft is reachable in the unit harness.)*

A 400 for a URL that does not resolve to `owner/repo` cannot be reached through
the dispatcher (the route regex already requires two path segments before
`/impact`). *(untested: defensive guard unreachable via the matched route.)*

## Out of Scope

- The `computeImpact` graph-walk algorithm and annotation/comment formatting —
  owned by `@re-cinq/lore-shared` (`spec-trace/trace-impact.ts`).
- The advisory GitHub Action that renders `annotations` / `comment`.
- Populating the spec-traceability graph — owned by the test-report / coverage
  ingest routes + the deferred projection layer.
