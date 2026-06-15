# Feature Specification: POST /api/repos/:owner/:repo/coverage

| Field      | Value                                                  |
|------------|--------------------------------------------------------|
| Feature    | Repo coverage ingest route                             |
| Status     | **Draft**                                              |
| Created    | 2026-06-10                                             |
| Owner      | Platform Engineering                                   |
| Route      | `POST /api/repos/:owner/:repo/coverage`                |
| Auth scope | `write` (SCOPE_OVERRIDES)                              |
| Module     | `mcp-server/src/api/routes/coverage.ts`                |

## Problem Statement

A project's CI run produces a per-test coverage report in one of several
formats (canonical JSON list, LCOV, or Cobertura). The spec-traceability graph
needs those covered file/line ranges as `Coverage` nodes and `COVERS` edges,
but a project should be able to upload whatever its toolchain emits without
pre-normalizing. This route accepts the three formats, normalizes them
mcp-server-side into one canonical group shape, counts the graph nodes/edges
the projection will create, echoes the counts, and fires a fire-and-forget
spec-trace projection trigger to the agent with the **already-normalized**
groups so the agent never re-parses LCOV/Cobertura.

## Interface

- **Method + path**: `POST /api/repos/:owner/:repo/coverage`
  (regex `^/api/repos/[^/]+/[^/]+/coverage(\?|$)`).
  Implemented by the [route registration](../../../apps/mcp-server/src/api/routes/index.ts#L72)
  dispatching to the [`handleCoverageRoute` handler](../../../apps/mcp-server/src/api/routes/coverage.ts#L38).
- **Auth scope**: `write`. Matched by `SCOPE_OVERRIDES`
  (`/api/repos/[^/]+/[^/]+/coverage(\?|$|/)` → `write`) so the route does
  **not** silently inherit the default `read` from the generic prefix table.
- **Rate bucket**: `default` (200/min) — not a `/api/task*` or webhook path.

### Request body (`CoverageBody`)

| Field      | Type              | Required | Notes |
|------------|-------------------|----------|-------|
| `commit`   | string            | yes      | Non-empty; enforced by `requireCommit`. |
| `coverage` | `CoverageGroup[]` | no       | Canonical pre-grouped form: `{ test, covered: {file,startLine,endLine}[] }[]`. Passes through untouched. |
| `format`   | `"lcov"\|"cobertura"` | no   | Tags a raw `payload`. Any other value → 400. |
| `payload`  | string            | no       | Raw LCOV / Cobertura text, normalized when `format` is set. |
| `branch`   | string            | no       | Accepted, not used in counting. |

### Response

`200 application/json` with `CoverageCounts`:

```
{ coverage_nodes: number, covers_edges: number, files_covered: number }
```

`400 application/json` `{ error: string }` on missing commit or unsupported
format.

## Behavior

1. The dispatcher (`handleApiRoute`) runs the cross-cutting gates first:
   rate-limit (`default` bucket), then bearer-token scope auth —
   `getRequiredScope(url)` returns `write` for this URL; a missing token → 401,
   an insufficient-scope token → 403.
2. `readJsonBody(req)` parses the body (empty body → `{}`; >1 MiB → rejects).
3. `requireCommit(body, res)` — if `commit` is absent or empty, write
   `400 { error: "required: commit" }` and return.
4. **Format guard** — if `body.format` is set and is neither `"lcov"` nor
   `"cobertura"`, write `400 { error: "unsupported format: <format>" }` and
   return.
5. **Normalization** (`normalizeByFormat`) resolves any supported shape to
   `CoverageGroup[]`:
   1. If `body.coverage` is present, return it verbatim.
   2. If `format === "lcov"` and `payload` is a string → `parseLcovGroups`.
   3. If `format === "cobertura"` and `payload` is a string →
      `groupByFile(parseCobertura(payload))`.
   4. Otherwise → `[]`.
6. **LCOV parse** (`lcovRecords` → `parseLcovGroups`): split on
   `^end_of_record$`; per record read `SF:` (file; skip record if absent),
   `TN:` (test name, falling back to the file), and `DA:line,hits` rows kept
   only when `hits > 0`. Covered line numbers are sorted and collapsed into
   contiguous `{file,startLine,endLine}` ranges by `collapseIntoRanges`.
   Records sharing a `TN` are merged into one group.
7. **Cobertura parse** (`parseCobertura`): per `<class filename=...>` block,
   read `<line number hits>` rows with `hits > 0`, collapse into ranges.
   `groupByFile` then makes one group per file (no per-test attribution in
   Cobertura), keyed by the filename — matching the canonical body's
   one-node-per-group counting.
8. **Fan-out** — `repoFromReposUrl(req.url)` pulls `owner/name` from the URL;
   on a match, `triggerAgentSpecTrace(repo, "coverage", { commit, coverage: groups })`
   is fired (`void`, not awaited) with the **normalized** groups. The trigger
   no-ops (warns) when `LORE_AGENT_URL` / `LORE_AGENT_INTERNAL_TOKEN` are unset.
9. **Counting** (`countCoverage`): `coverage_nodes` = number of groups,
   `covers_edges` = total covered chunks across groups, `files_covered` =
   distinct file count. Write `200` with the counts.

The handler never touches `_pool` — graph persistence is the deferred Dgraph
projection seam; this route only parses, normalizes, counts, and fans out.

## Output

| Condition | Status | Body |
|-----------|--------|------|
| Missing/empty `commit` | 400 | `{ "error": "required: commit" }` |
| Unsupported `format` | 400 | `{ "error": "unsupported format: <format>" }` |
| Success | 200 | `{ coverage_nodes, covers_edges, files_covered }` |
| No bearer token | 401 | `{ "error": "unauthorized" }` (dispatcher) |
| Token lacks `write` | 403 | `{ "error": "insufficient scope" }` (dispatcher) |

## Dependencies & side effects

- Handler `handleCoverageRoute`; parsers `parseLcovGroups` / `parseCobertura` /
  `collapseIntoRanges` (also exported for `coverage.test.ts`).
- `triggerAgentSpecTrace` fire-and-forget POST to `{LORE_AGENT_URL}/api/trigger/spec-trace`.
- Env: `LORE_AGENT_URL`, `LORE_AGENT_INTERNAL_TOKEN` (fan-out only);
  `LORE_INGEST_TOKEN` (legacy auth).
- No DB write, no Dgraph call (deferred projection seam).

## Acceptance Criteria

A canonical `coverage[]` body returns node = group count, edge = total covered
chunks, and file = distinct file count. ([validated by `returns 200 with node, edge, and file counts derived from the body`](../../../apps/mcp-server/src/api/routes/coverage-route.test.ts#L17))

An LCOV `payload` is parsed and normalized into per-file groups with collapsed
ranges before counting. ([validated by `returns 200 with counts from a normalized lcov payload`](../../../apps/mcp-server/src/api/routes/coverage-route.test.ts#L42))

Two `TN` tests on the same file produce two distinct coverage nodes.
([validated by `counts per-test nodes for an lcov payload with two TN tests on the same file`](../../../apps/mcp-server/src/api/routes/coverage-route.test.ts#L60))

A Cobertura `payload` is parsed into one file-keyed group with collapsed
ranges. ([validated by `returns 200 with counts from a normalized cobertura payload`](../../../apps/mcp-server/src/api/routes/coverage-route.test.ts#L79))

The spec-trace trigger fires with the normalized groups (not the raw payload)
when the agent env is configured. ([validated by `fires the spec-trace trigger with the normalized coverage groups when the agent env is configured`](../../../apps/mcp-server/src/api/routes/coverage-route.test.ts#L98))

An unsupported `format` is rejected with 400. ([validated by `returns 400 for an unsupported format`](../../../apps/mcp-server/src/api/routes/coverage-route.test.ts#L129))

A missing `commit` is rejected with 400. ([validated by `returns 400 when commit is missing`](../../../apps/mcp-server/src/api/routes/coverage-route.test.ts#L142))

LCOV `DA` rows with zero hits are filtered and a single covered line yields a
length-1 range. ([validated by `returns a length-1 range for one covered line`](../../../apps/mcp-server/src/api/routes/coverage.test.ts#L5))

Contiguous covered lines collapse into one range. ([validated by `collapses three contiguous covered lines into one range`](../../../apps/mcp-server/src/api/routes/coverage.test.ts#L12))

Records sharing a `TN` merge into one group spanning both files' chunks.
([validated by `merges two records sharing a TN into one group concatenating both files' chunks`](../../../apps/mcp-server/src/api/routes/coverage.test.ts#L41))

A Cobertura class block collapses contiguous covered lines per class.
([validated by `collapses contiguous covered lines per class into ranges`](../../../apps/mcp-server/src/api/routes/coverage.test.ts#L67))

## Out of Scope

- Dgraph projection of `Coverage` nodes / `COVERS` edges and idempotency on
  `commit` — deferred to the unbuilt `spec-traceability-graph` projection layer.
- The agent-side `/api/trigger/spec-trace` consumer.
- Test discovery / `validated_by` spec linking — owned by
  [`repo-test-report`](../repo-test-report/spec.md).
