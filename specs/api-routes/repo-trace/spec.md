# Feature Specification: GET /api/repos/:owner/:repo/trace/{kind}

| Field      | Value                                                  |
|------------|--------------------------------------------------------|
| Feature    | Repo spec-traceability read route                      |
| Status     | **Draft**                                              |
| Created    | 2026-06-10                                             |
| Owner      | Platform Engineering                                   |
| Route      | `GET /api/repos/:owner/:repo/trace/{specs\|spec-summaries\|adrs\|adr-summaries\|document\|source\|graph\|ring}` |
| Auth scope | `read` (default)                                       |
| Module     | `mcp-server/src/api/routes/trace.ts`                   |

## Problem Statement

The web UI is not a workspace member and must not read Postgres chunks or
Dgraph directly. It needs the spec-traceability graph projected into UI-ready
shapes: document path lists, an ordered `TraceDocument`, a byte-exact source
reassembly, a force-graph `SpecGraph`, and a per-statement-coverage `SpecRing`.
This route serves all of those through the shared `Project.trace` facade so the
graph stays the single source of truth and the UI never couples to storage.

## Interface

- **Method + path**: `GET /api/repos/:owner/:repo/trace/<kind>`
  (prefix `^/api/repos/[^/]+/[^/]+/trace/`).
  Implemented by the [route registration](../../../apps/mcp-server/src/api/routes/index.ts#L75)
  dispatching to the [`handleTraceRoute` handler](../../../apps/mcp-server/src/api/routes/trace.ts#L31).
  The handler re-validates with `TRACE_RE`
  (`^/api/repos/([^/]+)/([^/]+)/trace/(specs|spec-summaries|adrs|adr-summaries|document|source|graph|ring)(?:\?(.*))?$`).
- **Auth scope**: `read` (the default — no `SCOPE_OVERRIDES` entry covers
  `/trace/`, and the override list is deliberately explicit so trace reads do
  not inherit the dark-factory `admin` scope).
- **Rate bucket**: `default` (200/min).
- **Query**: `?path=<file>` — required for `document`, `source`, `ring`.

### Kinds and responses

| Kind | Query | `200` body |
|------|-------|-----------|
| `specs` | — | `{ specs: string[] }` (document paths) |
| `spec-summaries` | — | `{ summaries: SpecSummary[] }` |
| `adrs` | — | `{ adrs: string[] }` |
| `adr-summaries` | — | `{ summaries: AdrSummary[] }` |
| `graph` | — | `SpecGraph` (`{ nodes, links }`) |
| `document` | `path` | `TraceDocument` (ordered sections + statements + coverage) |
| `source` | `path` | `{ source: string \| null }` (byte-exact reassembly) |
| `ring` | `path` | `SpecRing` (sections + per-statement coverage) |

## Behavior

1. Dispatcher gates: rate-limit (`default`), then bearer auth —
   `getRequiredScope(url)` returns `read`. Missing token → 401; insufficient
   scope → 403.
2. `(req.url).match(TRACE_RE)` — on no match (unknown kind, missing path
   segment), write `404 { error: "not found" }` and return.
3. Destructure `owner`, `repo`, `kind`, `queryString`;
   `filePath = new URLSearchParams(queryString ?? "").get("path") ?? ""`.
4. `trace = (await projectFor("<owner>/<repo>")).trace` — the per-repo
   `Project` composition root. `projectFor` injects a real Dgraph client when
   `LORE_DGRAPH_HTTP` is set, else a no-op stub that throws on `newTxn()`.
5. Dispatch by kind:
   1. `specs` → `{ specs: await trace.specs() }`.
   2. `spec-summaries` → `{ summaries: await trace.specSummaries() }`.
   3. `adrs` → `{ adrs: await trace.adrs() }`.
   4. `adr-summaries` → `{ summaries: await trace.adrSummaries() }`.
   5. `graph` → `await trace.graph()`.
   6. **path-required gate** — if `!filePath`, write
      `400 { error: "path query param required" }` and return. This runs after
      the no-path kinds, so `document`/`source`/`ring` reach it.
   7. `document` → `await trace.document(filePath)`.
   8. `ring` → `await trace.ring(filePath)`.
   9. default (`source`) → `{ source: await trace.source(filePath) }`.
6. Any thrown error (including the no-op Dgraph stub throwing when
   `LORE_DGRAPH_HTTP` is unset) is caught → write
   `500 { error: <message> }`.

The handler never touches `_pool` directly — all reads go through `project.trace`.

## Output

| Condition | Status | Body |
|-----------|--------|------|
| Unknown kind / malformed URL | 404 | `{ "error": "not found" }` |
| `document`/`source`/`ring` without `?path=` | 400 | `{ "error": "path query param required" }` |
| Graph read (live Dgraph) | 200 | per-kind body above |
| Dgraph unset → stub throws / query error | 500 | `{ "error": "<message>" }` |
| No bearer token | 401 | `{ "error": "unauthorized" }` (dispatcher) |

## Dependencies & side effects

- Handler `handleTraceRoute`; `projectFor` (`project-boot.ts`) →
  `createProject` → `DgraphTrace` adapter (`shared/src/project/trace/`).
- Dgraph via `LORE_DGRAPH_HTTP`; Postgres pool via `getPool()` (Project
  composition).
- Env: `LORE_DGRAPH_HTTP`; `LORE_INGEST_TOKEN` (legacy auth).
- Read-only; no fan-out.

## Acceptance Criteria

An unknown trace kind is rejected with 404 `{ error: "not found" }`. ([validated by `trace.test.ts:30`](apps/lore-api/src/api/routes/trace/trace.test.ts#L30))

A matched trace kind passes the read-scope auth gate (no 401/403). ([validated by `trace.test.ts:43`](apps/lore-api/src/api/routes/trace/trace.test.ts#L43))

The `document`/`source`/`ring` `400 "path query param required"` gate is reached
only after a successful `projectFor`, so it needs a live Project/Dgraph backend
in the unit harness; and the `specs`/`adrs`/`graph`/`document`/`ring` success
bodies need a populated graph. *(untested: the no-path 400 sits behind
`await projectFor`, which throws without Dgraph in the unit harness and yields
500; the success branches need live Dgraph.)*

## Out of Scope

- The `TraceDocument` / `SpecGraph` / `SpecRing` projection shapes and the
  byte-exact `source` reassembly — owned by `shared/src/spec-trace/` and the
  `DgraphTrace` adapter.
- The cross-repo global spec list — owned by [`global-trace-specs`](../global-trace-specs/spec.md).
- The deferred Dgraph projection that populates the graph.
