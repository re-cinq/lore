# Feature Specification: CI Incremental Ingest

| Field   | Value                                                          |
| ------- | -------------------------------------------------------------- |
| Feature | CI incremental ingest — diff against the last-ingested commit  |
| Status  | In Progress                                                    |
| Created | 2026-09-03                                                     |
| Owner   | Platform Engineering                                           |
| ADR     | [`ADR-023`](../../adrs/ADR-023-test-run-trace-binding.md) (CI-driven test projection) |

Moves spec-traceability-graph ingestion out of per-chunk station pods and into
a direct CI → lore-api handshake: Lore keeps the last commit it ingested per
repo and kind, CI fetches it, `git diff`s against it, and posts only the DELTA
as JSON — changed doc contents, an incremental test report, and the deleted
paths — which lore-api projects in-process. The pod fan-out this replaces ran
16,228 ingest pods in one month (52 per merge on this repo alone: a ~26MB
full test report re-posted in 512KB chunks, one pod per chunk), each pod
projecting for ~2 minutes after minutes of scheduling ceremony, and the burst
rhythm was the main force holding the autoscaled node fleet inflated. The
delta of a typical merge is a handful of files, the runner already holds the
working tree and the report, and Actions minutes on this org's public repos
cost nothing — so the projection's marginal home is the API process that
already owns the dgraph egress and the Vertex embed path.

## Functional Requirements

- **FR1 — Lore keeps the last-ingested commit per repo and kind.**
  `GET /api/repos/{owner}/{repo}/ingest-state?kind=` answers with the commit
  the graph last absorbed for `specs`, `adrs` or `test-report`, read from
  `pipeline.ingest_state` (migration 0059, one CAS-target row per repo+kind —
  no history, because the graph itself is the durable outcome and a lost
  pointer costs exactly one full re-ingest). A null commit is the full-ingest
  signal, and a cluster whose migration has not landed answers null rather
  than 500 — "no recorded state" and "state table absent" mean the same thing
  to the caller: diff against nothing, send everything. An unknown kind is a
  400 naming the valid set.
  ([validated by returns the stored commit for the repo and kind](apps/lore-api/src/api/routes/ingest/ingest-state.test.ts#L38), [`ingest-state.test.ts:57`](apps/lore-api/src/api/routes/ingest/ingest-state.test.ts#L57), [`ingest-state.test.ts:69`](apps/lore-api/src/api/routes/ingest/ingest-state.test.ts#L69), [`ingest-state.test.ts:81`](apps/lore-api/src/api/routes/ingest/ingest-state.test.ts#L81))

- **FR2 — the pointer advances by compare-and-set, never a blind write.**
  Every delta names the state it OBSERVED as `base_commit` — what
  `GET …/ingest-state` returned, which is also the diff basis except when
  that commit is unreachable (FR5); the state row moves
  to the new commit only while it still equals that base (`IS NOT DISTINCT
  FROM`, so a first ingest CAS-es against null). A mismatch is a 409 carrying
  the current commit — the racing merge's CI re-fetches the state and
  re-diffs, so two merges landing together cannot silently skip one delta.
  The check is STRICT even when the stored state is null under a non-null
  claimed base: recorded state that vanished means the delta may miss earlier
  changes, and the refusal converges to a full ingest. The pre-check runs
  before projection (a stale delta is refused before any graph write) and the
  CAS after it (a failed projection must never move the pointer past work
  that did not land; projection is idempotent xid upserts, so the loser of
  the rare mid-flight race redoes harmless work).
  ([validated by refuses a stale base with a 409 naming the current commit, and projects nothing](apps/lore-api/src/api/routes/ingest/ingest-delta.test.ts#L192), [`ingest-delta.test.ts:113`](apps/lore-api/src/api/routes/ingest/ingest-delta.test.ts#L113), [`ingest-delta.test.ts:286`](apps/lore-api/src/api/routes/ingest/ingest-delta.test.ts#L286))

- **FR3 — the delta is JSON posted straight to lore-api, projected in-process.**
  `POST /api/repos/{owner}/{repo}/ingest` (write scope) takes the kind, the
  commit pair, changed doc files with their content inline (the runner has the
  tree; the server needs no clone), the deleted paths, or the incremental
  test report — and projects it right there via the shared projectors
  (`projectSpecFile`/`projectAdrFile`/`ingestSpecTrace`): no event row, no
  assembly line, no pod. A payload too large for one body — the full-ingest
  fallback — rides a `{seq, total}` chunk envelope; every chunk projects
  immediately (idempotent), and the state advances only with the final chunk.
  Unknown kinds and malformed commits are 400s; a deployment without
  `LORE_DGRAPH_HTTP` refuses with a 503 naming the missing configuration
  instead of pretending to ingest.
  ([validated by projects changed docs, prunes deleted ones, and advances the state](apps/lore-api/src/api/routes/ingest/ingest-delta.test.ts#L113), [`ingest-delta.test.ts:147`](apps/lore-api/src/api/routes/ingest/ingest-delta.test.ts#L147), [`ingest-delta.test.ts:165`](apps/lore-api/src/api/routes/ingest/ingest-delta.test.ts#L165), [`ingest-delta.test.ts:213`](apps/lore-api/src/api/routes/ingest/ingest-delta.test.ts#L213), [`ingest-delta.test.ts:250`](apps/lore-api/src/api/routes/ingest/ingest-delta.test.ts#L250), [`ingest-delta.test.ts:273`](apps/lore-api/src/api/routes/ingest/ingest-delta.test.ts#L273))

- **FR4 — deletions ride in the payload and prune their graph subtrees.** An
  incremental report carries only CHANGED tests, so absence stops meaning
  anything — the deleted paths are named explicitly. For docs the existing
  whole-file prune (`deleteSpecSubtree`/`deleteAdrSubtree`) runs per deleted
  path. For test files, `pruneTestFiles` deletes the file's whole subtree:
  every TestChunk (per-test and the file-scoped coverage anchor), its
  TestSuites, the Coverage nodes hanging off them, and the incoming edges
  that would otherwise dangle — a Statement's or AcceptanceCriterion's
  `validated_by` (the statement itself survives, reporting the link broken)
  and the Repo root's `test_chunks`/`test_suites`. CodeChunks and Files the
  doomed Coverage covered are garbage-collected through the shared ownership
  rules, so a code chunk still covered by another test file survives. A path
  with no graph presence prunes as a no-op, so a re-driven prune converges.
  ([validated by prunes every TestChunk and TestSuite of the named files and keeps the rest](libs/shared/src/spec-trace/prune-test-files.test.ts#L123), [`prune-test-files.test.ts:160`](libs/shared/src/spec-trace/prune-test-files.test.ts#L160), [`prune-test-files.test.ts:188`](libs/shared/src/spec-trace/prune-test-files.test.ts#L188), [`prune-test-files.test.ts:222`](libs/shared/src/spec-trace/prune-test-files.test.ts#L222))

## Planned (next slices)

The CI half and the rollout are follow-up slices, specified here so the
routes above have their consumer named:

- **FR5 — the runner diffs and filters (lore-code-trace).** Fetch the state;
  no state ⇒ full ingest with `base_commit: null`. A state whose commit is
  UNREACHABLE in the runner's history (force-pushed main, over-shallow
  clone) ⇒ full ingest CONTENT with `base_commit` still set to the observed
  commit — the CAS target is the observed state, not the diff basis, and
  posting null against a recorded state would 409 on every retry forever.
  Otherwise `git diff --name-status <base>..HEAD` (the workflow
  checkout needs `fetch-depth: 0`; a shallow clone cannot reach the base) and
  send: tests living in changed test files, every test whose coverage touches
  ANY changed file (an edit shifts the line ranges of everything below it in
  the same file, so file-granularity re-projection is the correct unit), and
  the deleted paths. On a 409, re-fetch the state and re-diff once before
  giving up loudly.

- **FR6 — onboarding scaffolds the incremental flow.** The `onboard` task's
  generated `lore-tests.yml` / `lore-ingest.yml` workflows and the
  `LORE_TESTS_INSTRUCTION` prompt teach the handshake — state fetch, diff,
  JSON POST — instead of the retired chunk-webhook fan-out.

- **FR7 — the pod path retires.** Once onboarded repos post deltas, the
  `internal.ingest.spec_trace` payload-kind fan-out (one ingest assembly line
  and one pod per 512KB chunk) and the Floor `ci-tests` webhook ingress are
  removed; the ingest station keeps only what still needs a clone.
