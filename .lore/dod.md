# Definition of Done

> `Repo.trace_commit` ... anchors every line range to whatever commit CI
> last projected. That anchor is what makes the pre-merge impact check
> sound — and it is also the reason the implementation loop is blind to its
> own work.

**Strategy: `changes_requested`** — no faithful acceptance test can be made
red in this container, and the ones that can be made red fail for a reason
narrower than the ticket's claim. This is the whole vertical of epic #1772,
not one facet. See "Why blocked" below.

## Why blocked

**1. It is really several tickets.** The Proposal + Implementation hints
bundle six independently-shippable production changes across three
languages:

- **producer** — `lore-code-trace` gains a `--definitions-only`/overlay
  mode and POSTs `assemblyRunId` (Go: `apps/lore-code-trace/report.go`,
  `chunk.go`).
- **ingest routing** — the ci-tests ingress routes a branch/overlay payload
  to overlay mode (`apps/floor/src/events/listeners/ci-tests-map.ts`,
  `apps/floor/src/transport/http/routes/ci-tests.ts`).
- **ingest overlay mode** — a NEW `Overlay` Dgraph node type + the
  `${repo}|run:${assemblyRunId}|<path>#<symbol>` xid namespace + a
  spec-trace schema migration; `ingestTestReport` writes overlay-scoped
  chunks (`libs/shared/src/work/spec-trace/ingest-test-report.ts`,
  `test-chunk-identity.ts`, `setup-spec-trace-schema.sh`).
- **query union** — `runQueryTrace` / `assemble-trace-document.ts` gain an
  optional `assemblyRunId` and union overlay over main, overlay-wins-per-path,
  statements/ACs/ADRs never overlaid
  (`libs/server-core/.../query-trace.ts`, `trace-dgraph.ts`).
- **lifecycle** — the `retrospective` station drops the overlay, and
  `gc-orphan-chunks.ts` sweeps overlays whose run is terminal (14-day
  retention).
- **impact route** — `POST /api/repos/:o/:r/impact` gains optional
  `assemblyRunId` and uses the overlay `head_commit` as the coordinate
  system (`apps/lore-api/src/transport/routes/impact/*`).

Its own Acceptance section is three integration-level assertions, each
spanning multiple of those layers. A well-formed loop ticket is one facet
with <=5 acceptance tests; this is the epic.

**2. Its stated acceptance is only observable through the live graph, and
this container has no way to run it red.** All three acceptance bullets are
Dgraph-backed (and bullet 1 also needs the Go binary + ingest wiring):

- "After a `tdd-round` push, `lore-query-trace` with the run id returns the
  test the round just wrote as a `TestChunk` with the branch head as its
  coordinate."
- "The same query **without** the run id is byte-identical to today's
  answer."
- "A run reaching `retrospective` leaves zero `Overlay`-prefixed xids for
  its id."

The `ingestTestReport` / query suites are `describe.skipIf(!reachable)`
against a live Dgraph on `:8081`. This container has **no docker, no
Dgraph, no Go** (verified: `dgraphReachable()` false; `which docker go`
empty), so a faithful acceptance test SKIPS here rather than failing. A skip
is a guess, not a red bar. CI runs these via the `pr-checks` dgraph matrix +
`test-integration.yml`, but the DoD contract requires a locally-verified red
bar and this pod cannot produce one for the vertical.

**3. Every slice I can run red here is unfaithful.** The only non-Dgraph
seams are pure helpers — `mapCiTests` threading `assemblyRunId`, or an
`overlayXid` producing the `run:` segment. Each of those can pass while the
loop is still blind (no ingest overlay, no query union, no lifecycle), i.e.
it fails for a reason the ticket never states. A PR that greens it closes
the report without fixing it — the `changes_requested` failure mode the
contract names.

## What is needed to unblock

Split epic #1772 into sub-tickets, each with a Dgraph-matrix acceptance test
(the `pr-checks` `matrix.dgraph` / `test-integration` lane), so the DoD and
implementation pods run against Dgraph:

- **producer** — `lore-code-trace` overlay/definitions-only POST carries
  `assemblyRunId` (Go test, `apps/lore-code-trace/*_test.go`, no Dgraph).
- **ingest-overlay** — `ingestTestReport` in overlay mode writes
  `${repo}|run:${id}|...` chunks hung off an `Overlay` root; schema
  migration for the `Overlay` type (live-Dgraph test).
- **query-overlay** — `runQueryTrace(repo, {assemblyRunId})` unions overlay
  over main (overlay-wins-per-path; statements never overlaid; no-run-id
  byte-identical) (live-Dgraph test).
- **lifecycle** — retrospective drop + `gc-orphan-chunks` sweep leave zero
  `Overlay` xids for a terminal run (live-Dgraph test).
- **impact** — `POST /impact` optional `assemblyRunId` uses the overlay
  `head_commit` (route test).

Then amend `specs/spec-traceability-graph/data-model.md`,
`specs/implementation-loop/spec.md`, and note in
`specs/test-run-trace-binding/spec.md` that the branch field is consumed,
with each new statement carrying its `([validated by ...])` link to the
corresponding sub-ticket's test.

## Out of scope

- Multiple concurrent overlays for one branch.
- Overlaying spec/ADR nodes.
- The local runner writing overlays.
