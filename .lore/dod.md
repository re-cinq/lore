# Definition of Done

> Make per-test coverage available to the loop for its own branch. This is
> almost entirely a consequence of the run-overlay issue (#1769): once an
> overlay exists, the coverage half of the `lore-code-trace` report lands in
> it instead of being discarded.

**Strategy: `changes_requested`** — the behaviour that addresses the ticket's
stated problem (branch-scoped coverage during a run) has a hard, unmet
dependency on #1769, and the one independently-shippable slice can only be
verified against infrastructure this DoD container does not have. No acceptance
test can be made to fail red for the ticket's own reason here. Parked for a
human to split and sequence.

## Why it is blocked (verified in this checkout)

1. **#1769 (run overlay) is entirely unbuilt.** There is no `overlay`,
   `assembly_run_id`, run-prefix xid, or `head_commit` plumbing anywhere in the
   coverage ingest path (`libs/shared/src/work/spec-trace/ingest-coverage.ts`,
   `ingest-test-report.ts`), the Floor `ci-tests` webhook
   (`apps/floor/src/events/listeners/ci-tests-map.ts`), or the `lore-code-trace`
   binary (`apps/lore-code-trace/`). `Coverage` is still keyed on
   `repo|testFile|testName` with `Coverage.commit` = the pushed commit. The
   ticket's acceptance criteria 2 and 3 both say verbatim "Depends on the
   overlay issue (#1769)"; until it lands there is no branch-scoped graph to
   query and no run-id to scope by.

2. **The `main`-scoped `tests_covering(file, range)` query does not exist and
   is a live-Dgraph read.** `lore-query-trace` today is spec-rooted
   (`libs/server-core/src/work/spec-trace/query-trace.ts` → the backend
   `/trace/document` route → `DgraphTrace.document`). A file-rooted reverse-walk
   of `Coverage.covers` is a new backend read route + a new MCP tool shape; the
   `specs/query-trace-tool/spec.md` Out of Scope even records the test-rooted
   direction as needing "a separate read endpoint." Its acceptance — "returns
   the expected `TestChunk`s on this repo for `evaluateAutoMerge`
   (`apps/floor/src/work/merge/auto-merge.ts`)" — is an assertion against the
   live graph. Every graph suite in this repo is gated
   `describe.skipIf(!(await dgraphReachable()))`
   (`libs/shared/src/lib/dgraph-test-gate.ts`), and this container has **no
   reachable Dgraph and no docker/dgraph binary to stand one up**. Such a test
   would SKIP, not fail red — the DoD contract requires an observed, quoted red
   bar, which cannot be produced here.

3. **Criterion 3 is a `tdd-round` prompt/skill change, deferred by the ticket
   itself** ("This is a prompt/skill change, not a Floor change; do it after
   the query exists"). It cannot precede the query, which is blocked by (1).

## What is really being asked (really several tickets)

- **A.** New backend read route + `lore-query-trace tests_covering(file, range)`
  shape — reverse-walk `Coverage.covers` from a `File` node, filter by facet
  range overlap, render `name — file:line — [statement label | unlinked]`
  (main-scoped; the "independently shippable" slice). Needs a live-Dgraph
  acceptance seam.
- **B.** Overlay integration (#1769): coverage lands in the run overlay; the
  query runs against `overlay ∪ main` scoped by run id. **Blocked on #1769.**
- **C.** `tdd-round` prompt change (`scripts/task-types.yaml` + the shadowing
  `lore.agent_definitions` row): call `tests_covering` before editing, diff the
  red set against the round's own new tests, surface remaining reds as
  `regression`, carry the count in `LORE_NODE_RESULT`. **Blocked on A.**

## What would unblock this

- #1769 landed first (so B/C have a branch-scoped graph and run-id to scope by).
- A DoD container where the live spec-trace Dgraph is reachable (so slice A's
  reverse-walk acceptance test can be observed red), OR slice A re-filed with an
  explicit non-graph seam for its acceptance.
- The ticket split into A / B / C so each carries an independently observable
  red bar.

## Out of scope

- Coverage on `main` — unchanged, still CI-driven.
- Mutation testing / Stryker — separate skill, separate signal.
