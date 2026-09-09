# Definition of Done

> We have the *richer* record — `pipeline.station_runs` carries `outcome`,
> `failureClass`, `failureDetail`, `commitSha`, `nodeId`, `iteration` ... and
> `agent_run_events` has the per-tool-call transcript with `file_paths`
> extracted — and **none of it is joined to a `File` or `CodeChunk`**. "What
> failed here before" is unanswerable from the graph.

**Strategy: `changes_requested`** — the ticket's acceptance is graph state
plus an agent-transcript ordering. In this pod neither can be given a red
acceptance test, and the one test that *is* red here would go green without
the fix — closing the report without fixing it. This is a well-motivated,
shippable feature; it is blocked on the DoD contract, not on merit. Details
below so a human can unblock it or split it, and the next pod inherits the
map rather than re-deriving it.

## Why no red acceptance test can be written here

1. **AC 1–3 are Dgraph state, and Dgraph is untestable in this pod.** A
   `Failure` node with `File`/`CodeChunk` edges (AC1), a `resolved_by_commit`
   stamp (AC2), and a `failures_touching(<path>)` query returning them newest
   first (AC3) are all *graph reads/writes*. This repo tests every graph
   behaviour against a **live Dgraph**, gated by
   `describe.skipIf(!dgraphReachable())`
   (`libs/shared/src/work/spec-trace/ingest-test-report.test.ts`,
   `ingest-coverage.test.ts`, `outbound/spec-trace/dgraph-upsert.test.ts`).
   Dgraph is **not reachable here** (`http://localhost:8081/health` → connection
   refused) and there is **no docker** to start `dgraph/standalone` the way CI's
   `pr-checks.yml` dgraph matrix lane does. A live-Dgraph acceptance test would
   **skip**, not fail — which is not a red bar. The contract requires each
   acceptance test to be run and quoted red; a skipped test is "a guess."

2. **The `DgraphClientPort` seam exists but faking it here = mocking the unit
   under test.** Every ingest/read takes `DgraphClientPort` (injected, never
   `new`ed — `libs/shared/src/domain/memory-store-types.ts`). The only existing
   fake is `scriptedPort` in `dgraph-upsert.test.ts`, a hand-scripted
   `newTxn/queryWithVars/mutate/discard` double used to drive txn-abort retry.
   To assert "a Failure node with a File edge was written" or "failures_touching
   returned it" through that fake, I would have to script the graph's own
   query/mutation responses — i.e. mock the thing being verified. The contract
   forbids mocks/stubs and says a behaviour that needs a double is a missing
   seam. The genuine seam is a live Dgraph, absent here.

3. **The one red-here test would go green without the fix.** The pure,
   deterministic slice I *can* exercise is a `failureDetail → {path,line}`
   extractor (tsc/eslint `path:line:col:`, go `--- FAIL: TestX (file_test.go)`)
   plus the infra-vs-code projection gate (AC4: a boot-crash class implicates no
   file). Both are pure and red here. But passing them does **not** put a node
   in the graph or make `failures_touching` answer — the projection could be
   entirely unwired and the extractor still green. A DoD built on it lets a PR
   go green while "unanswerable from the graph" is still true. The contract
   calls this a redefinition ("a merged PR built on it closes the report
   without fixing it. That is `changes_requested`, not a DoD").

4. **AC 5 is not unit-observable.** "`fix-ci` transcript (run page) shows the
   query being called before the first file read" is a runtime property of an
   LLM agent obeying a prompt. It is a manual/e2e acceptance check, not an
   executable test with a real entry point.

## What the ticket also needs resolved (a real defect, not just environment)

- **The projection gate keys on failure classes that do not exist.** The hint
  "only `failureClass` values that name code — validate/lint/typecheck/test
  failures" has no counterpart in the model. `stationNodeOutcome`
  (`libs/assembly-lines/src/node-outcome.ts:137`) gives a validation failure
  `failureClass: null` (outcome `failed`, suite names lifted into
  `failureDetail` as `validation failed: lint,build\n\n<output>`), while only
  infra/boot-crash failures carry a `FAILURE_CATEGORIES` class
  (`anthropic-credit` | `infra` | `unclaimed` | ... — `error-classify.ts:2`).
  So the code-vs-infra gate cannot allowlist "validate/lint/typecheck/test";
  it must invert — exclude the infra `FAILURE_CATEGORIES` set (and require a
  parseable `failureDetail`/`file_paths`). This needs deciding before the gate
  can be specified, and directly governs AC4.

## What would unblock this ticket

- **Provide a live Dgraph to the DoD/implementation pods** (as CI's
  `pr-checks.yml` dgraph lane does: `docker run dgraph/standalone` on :8081 +
  `npm run dgraph:schema`). Then the graph acceptance tests (AC1–3) can be
  written in the repo's live-Dgraph idiom and run genuinely red here.
- **OR split the ticket** into slices whose seam is testable in-process:
  1. `failureDetail → {path,line}` extractor per tool + the invert-the-infra
     gate (pure; red here; AC4 + the file-extraction half of AC1). This is the
     honest first slice.
  2. Dgraph `Failure`-node projection + schema predicate + reverse edges
     (`~Failure.files`/`~Failure.chunks`) — live-Dgraph, AC1 node/edges.
  3. `resolved_by_commit` resolution algorithm across station_runs on a run —
     live-Dgraph, AC2.
  4. `failures_touching` query in `lore-query-trace` + the `/trace` route +
     MCP tool — live-Dgraph read + a pure formatter test (AC3).
  5. `fix-ci`/`tdd-round` prompt wiring in `scripts/task-types.yaml` — verified
     by the implementation-loop acceptance harness / manual run (AC5).
- **AND resolve the failure-class vocabulary** (the gate defect above) so AC4
  can be stated precisely.

## Map for the implementer (verified during triage)

- Settlement seam (where the projection would fire, fire-and-forget /
  skip-not-fail like `agent_run_events`):
  `apps/floor/src/work/assembly-run/finish-node.ts` `closeNodeRow` /
  `node-terminal.ts` `finishNodeTerminal`. `commitSha`/`stationRunId` are read
  back via `deps.assemblyRuns.listStationRuns(...)` (the node-event path passes
  `commitSha: undefined`).
- Dgraph write facade: `libs/shared/src/outbound/spec-trace/dgraph-upsert.ts`
  (`upsertByXid`, `replaceEdge`, `withTxn`). Schema:
  `scripts/infra/setup-spec-trace-schema.sh` (heredoc DQL; add `Failure.*`
  predicates + reverse edges here). Node-type union in `dgraph-upsert.ts`.
- Range overlap to reuse (`{path,line}` → `CodeChunk`):
  `libs/shared/src/work/spec-trace/line-range.ts` (`intervalsOverlap`,
  `parseRanges`) + `impact-code-graph.ts` (`implChunkInScope`). NB: the ticket
  cites `impact-statement.ts` for the overlap, but the arithmetic actually
  lives in `line-range.ts`/`impact-code-graph.ts`.
- Read side: `lore-query-trace` MCP tool
  (`apps/mcp-server/src/transport/tools/spec-trace-tools.ts`) →
  `runQueryTrace` (`libs/server-core/src/work/spec-trace/query-trace.ts`,
  fake-`proxyGet` testable) → `/api/repos/:o/:r/trace/...`
  (`apps/lore-api/src/transport/routes/trace/trace.ts`) → `TracePort`
  (`trace-dgraph.ts`). No `failures_touching`/`Failure` symbol exists yet.
- `agent_run_events.file_paths` fallback: rows carry a correlated
  `station_run_id`, but there is **no read-by-station-run method** on
  `AgentRunEventsRepository` today — one (`WHERE station_run_id = $1`) must be
  added for the fallback.
