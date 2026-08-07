# Feature Specification: POST /api/repos/:owner/:repo/impact

| Field      | Value                                                  |
|------------|--------------------------------------------------------|
| Feature    | Repo pre-merge spec-impact query route                 |
| Status     | In Progress                                            |
| Created    | 2026-06-10                                             |
| Owner      | Platform Engineering                                   |
| Route      | `POST /api/repos/:owner/:repo/impact`                  |
| Auth scope | `write` (SCOPE_OVERRIDES)                              |
| Module     | `mcp-server/src/api/routes/impact.ts`                  |

POST /api/repos/:owner/:repo/impact is a deterministic pre-merge graph read that reports which spec statements a PR diff couples to or orphans, plus Checks-API annotations and a markdown comment, failing soft to a neutral result when the traceability graph is unreachable.

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
  Implemented by the [route registration](../../../apps/lore-api/src/server/build-server.ts#L116)
  dispatching to the [`handleImpactRoute` handler](../../../apps/lore-api/src/api/routes/impact/impact.ts#L48).
- **Auth scope**: `write`. Matched by `SCOPE_OVERRIDES`
  (`/api/repos/[^/]+/[^/]+/impact(\?|$|/)` → `write`). The write scope reflects
  the privileged ingest surface, **not** test execution — a graph read is not
  gated by the trust boundary that forbids running tests on the shared server.
- **Rate bucket**: `default` (200/min).

### Request body (`ImpactBody`)

| Field         | Type             | Required | Notes |
|---------------|------------------|----------|-------|
| `protocol`    | number           | no       | Wire format. Absent → treated as 1 and the findings are suppressed. |
| `commit`      | string           | no       | Diff head (informational). |
| `base`        | string           | no       | Merge base the diff was taken from. |
| `graphCommit` | string \| null   | no       | Baseline the client aligned against, from `GET …/impact/base`. |
| `files`       | `ChangedRange[]` | no       | `{ path, ranges, baseRanges?, deleted?, aligned? }`. Non-array → `[]`. |
| `docs`        | `ChangedDoc[]`   | no       | `{ path, content }` head text of changed spec/ADR files. Non-array → `[]`. |

The three range arrays are not interchangeable, and conflating them is what made
this route's answers untrustworthy:

- **`baseRanges` → graph lookup.** Old side of every hunk, in the diff base's
  numbering, which is the numbering the graph's ranges are expressed in. Includes
  pure insertions (`@@ -100,0 +101,5 @@`) as a straddling interval.
- **`ranges` → annotation anchoring only.** Head-side, because that is what the
  GitHub Checks API needs.
- **`deleted` → orphan detection.** Old-side deletions.

`aligned` records whether the file is byte-identical at `graphCommit` and at
`base`. Only then is `baseRanges` exactly graph coordinates.

### Response

`200 application/json`: `{ ...ImpactReport, annotations, comment }` where
`ImpactReport` is
`{ status, protocol?, coordinates?, skipped?, statements, orphaned, testSelectors, graphCommit?, graphCommitAt?, examined? }`.

`examined` carries `{ files, withGraphData, docs, newStatements, changedWithoutTests }` —
the numbers behind an honest negative.

`400 application/json` `{ error: "could not resolve repo from url" }` if the
URL does not yield `owner/repo`.

### `GET /api/repos/:owner/:repo/impact/base`

Serves the commit whose line numbering the repo's graph ranges are expressed in,
so the client can decide per file whether its diff is comparable. Scope `read`.
Returns `200 { graphCommit, graphCommitAt, source }`, with
`{ graphCommit: null, source: "none" }` both for a repo that has never been
stamped and for a Dgraph outage — a missing baseline degrades the check, it does
not fail it. Implemented by [`impactBaseRoute`](../../../apps/lore-api/src/api/routes/impact/impact-base.ts#L21).

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
   2. A client that did not declare `protocol: 2` computed its diff against the
      base-branch tip rather than the merge base, so its file list carries
      everything merged to the base since the branch point. Its findings are
      suppressed — `{ status:"ok", protocol:1, statements:[], skipped:[{ path:"*",
      reason:"legacy-client" }] }` — and the comment explains why instead of
      publishing them.
   3. Otherwise `await computeImpact(dgraph, repo, files, { docs, protocol })`
      walks four coupling routes, each with its own evidence tier:
      - CodeChunk overlap → `~Statement.implemented_by` (`file-link`),
      - Coverage-facet overlap → TestChunk → `~Statement.validated_by` (`coverage`),
      - `TestChunk.file_path` → `~Statement.validated_by` (`test-link`), which is
        how a changed test couples to what it was holding up,
      - changed spec → `Statement.text_hash` delta (`statement-edit`), which is
        how a spec-only PR couples at all.

      The first two are line-precise and run only for files whose `aligned` flag
      and a present baseline make the coordinates comparable; the rest are
      coordinate-free and always run. Every skipped file is recorded in
      `skipped[]` with its reason (`unaligned` / `no-baseline`).
   4. A thrown error (reachable Dgraph, broken DQL / missing schema) is caught,
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

An unparseable request body is rejected with a native 400 (ADR-034 hapi payload parse). ([validated by `impact-route.test.ts:75`](apps/lore-api/src/api/routes/impact/impact-route.test.ts#L75))

The body accepts a `docs[]` array carrying the head text of changed spec/ADR files, forwarded to `computeImpact` as `ImpactOptions.docs` for the statement-identity coupling. Like `files`, it is validated as `unknown` and degrades to `[]` rather than 400ing, so a client sending a shape this server does not understand still gets an advisory answer. ([validated by `impact-route.test.ts:61`](apps/lore-api/src/api/routes/impact/impact-route.test.ts#L61))

`GET …/impact/base` serves the graph baseline and answers `{ graphCommit: null, source: "none" }` rather than erroring when Dgraph is unconfigured, so a missing baseline degrades the check instead of failing it; a request without a token is rejected. ([validated by `impact-base-route:35`](apps/lore-api/src/api/routes/impact/impact-base-route.test.ts#L35), [validated by `impact-base-route:42`](apps/lore-api/src/api/routes/impact/impact-base-route.test.ts#L42))

A client that does not declare `protocol: 2` has its findings suppressed and is told why, because a diff taken against the base-branch tip carries every commit merged to the base since the branch point. ([validated by `trace-impact:716`](libs/shared/src/spec-trace/trace-impact.test.ts#L716), [validated by `trace-impact:729`](libs/shared/src/spec-trace/trace-impact.test.ts#L729))

The `status:"ok"` branch (coupled statements + orphans + non-empty annotations
from a live graph walk) is exercised against a live Dgraph, which PR Checks now
provides. ([validated by `trace-impact:254`](libs/shared/src/spec-trace/trace-impact.test.ts#L254), [validated by `trace-impact:325`](libs/shared/src/spec-trace/trace-impact.test.ts#L325), [validated by `trace-impact:404`](libs/shared/src/spec-trace/trace-impact.test.ts#L404), [validated by `trace-impact:539`](libs/shared/src/spec-trace/trace-impact.test.ts#L539))

A 400 for a URL that does not resolve to `owner/repo` cannot be reached through
the dispatcher (the route regex already requires two path segments before
`/impact`). *(untested: defensive guard unreachable via the matched route.)*

## Out of Scope

- The `computeImpact` graph-walk algorithm and annotation/comment formatting —
  owned by `@re-cinq/lore-shared` (`spec-trace/trace-impact.ts`).
- The advisory GitHub Action that renders `annotations` / `comment`.
- Populating the spec-traceability graph — owned by the test-report / coverage
  ingest routes + the deferred projection layer.
