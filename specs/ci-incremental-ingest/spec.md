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
  ([validated by returns the stored commit for the repo and kind](apps/lore-api/src/transport/routes/ingest/ingest-state.test.ts#L35), [`ingest-state.test.ts:54`](apps/lore-api/src/transport/routes/ingest/ingest-state.test.ts#L54), [`ingest-state.test.ts:66`](apps/lore-api/src/transport/routes/ingest/ingest-state.test.ts#L66), [`ingest-state.test.ts:78`](apps/lore-api/src/transport/routes/ingest/ingest-state.test.ts#L78), [`ingest-state.test.ts:103`](apps/lore-api/src/transport/routes/ingest/ingest-state.test.ts#L103))

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
  the rare mid-flight race redoes harmless work). On a cluster whose state
  table has not been migrated the projection still lands and the response
  says `unrecorded` instead of 500-ing CI — the next state fetch answers
  null and the flow degrades to a full ingest per push.
  ([validated by refuses a stale base with a 409 naming the current commit, and projects nothing](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L191), [`ingest-delta.test.ts:103`](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L112), [`ingest-delta.test.ts:356`](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L365), [`ingest-delta.test.ts:258`](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L267), [`ingest-delta.test.ts:302`](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L311), [`ingest-delta.test.ts:329`](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L338))

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
  ([validated by projects changed docs, prunes deleted ones, and advances the state](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L112), [`ingest-delta.test.ts:137`](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L146), [`ingest-delta.test.ts:155`](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L164), [`ingest-delta.test.ts:200`](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L209), [`ingest-delta.test.ts:235`](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L244), [`ingest-delta.test.ts:289`](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L298), [`ingest-delta.test.ts:375`](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L384))

  A test-report delta built on a branch other than the repo's default one is
  work in flight, not `main`: it is ingested into that branch's overlay, prunes
  none of `main`'s test files (its deleted paths are relative to `main`'s
  commit), leaves the stored commit where it was, and answers `overlay`. A
  delta for the default branch projects onto `main` exactly as before.
  ([validated by writes a feat/x test-report delta into the feat/x overlay and prunes none of main's test files](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L522), [validated by leaves main's stored commit where it was and answers state overlay for a feat/x delta](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L537), [validated by ingests a main delta onto main when the default branch is main](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L550))

- **FR4 — deletions ride in the payload and prune their graph subtrees.** An
  incremental report carries only CHANGED tests, so absence stops meaning
  anything — the deleted paths are named explicitly. For docs the existing
  whole-file prune (`deleteSpecSubtree`/`deleteAdrSubtree`) runs per deleted
  path. For test files, `pruneTestFiles` deletes the file's whole subtree:
  every TestChunk (per-test and the file-scoped coverage anchor), its
  TestSuites, the Coverage nodes hanging off them, and the incoming edges
  that would otherwise dangle — a Statement's or AcceptanceCriterion's
  `validated_by` (the statement itself survives, reporting the link broken)
  and the Repo root's `test_chunks`/`test_suites`/`coverage`. CodeChunks and Files the
  doomed Coverage covered are garbage-collected through the shared ownership
  rules, so a code chunk still covered by another test file survives. A path
  with no graph presence prunes as a no-op, so a re-driven prune converges.
  ([validated by prunes every TestChunk and TestSuite of the named files and keeps the rest](libs/shared/src/work/spec-trace/prune-test-files.test.ts#L110), [`prune-test-files.test.ts:142`](libs/shared/src/work/spec-trace/prune-test-files.test.ts#L145), [`prune-test-files.test.ts:193`](libs/shared/src/work/spec-trace/prune-test-files.test.ts#L196), [`prune-test-files.test.ts:230`](libs/shared/src/work/spec-trace/prune-test-files.test.ts#L233), [`prune-test-files.test.ts:171`](libs/shared/src/work/spec-trace/prune-test-files.test.ts#L174))

- **FR5 — the runner diffs and filters (lore-code-trace).** `--post` now
  runs the handshake before anything else: it fetches the state for
  `test-report`; no state ⇒ a full ingest posted with `base_commit: null`. A
  state whose commit is UNREACHABLE in the runner's history (force-pushed
  main, over-shallow clone) ⇒ full ingest CONTENT with `base_commit` still set
  to the observed commit — the CAS target is the observed state, not the diff
  basis, and posting null against a recorded state would 409 on every retry
  forever. Otherwise `git diff --name-status <base>..HEAD` (the workflow
  checkout carries `fetch-depth: 0`; a shallow clone cannot reach the base)
  selects the tests living in changed test files plus every test whose
  coverage touches ANY changed file — an edit shifts the line ranges of
  everything below it in the same file, so file-granularity re-projection is
  the correct unit — and names the deleted paths (a rename deletes its old
  path). On a 409 the runner re-fetches the state and re-diffs exactly once
  before failing the step out loud. A lore-api that does not serve the routes
  yet reads as "no state" on the fetch and as a typed absence on the post, and
  the runner falls back to the chunked webhook rather than reddening CI. A delta that would exceed lore-api's 1 MiB body cap — the full ingest after a missing or unreachable state — rides FR3's `{seq, total}` envelope, split per descriptor under the cap, every chunk carrying the same observed base and the deleted paths riding the first; a delta that fits posts as one unchunked body. A delta post retries transient failures — a transport error, a 5xx or a 429 — with the webhook path's attempt budget and backoff, since projection is idempotent; a 409 never retries (the flow re-diffs instead) and neither does any other client error. The delta path uses its own five-minute client: the request waits on an in-process projection, not on a webhook's immediate 202.
  ([validated by [`delta_test.go:8`](apps/lore-code-trace/delta_test.go#L8), [`delta_test.go:23`](apps/lore-code-trace/delta_test.go#L23), [`delta_test.go:55`](apps/lore-code-trace/delta_test.go#L55), [`delta_test.go:69`](apps/lore-code-trace/delta_test.go#L69), [`delta_test.go:79`](apps/lore-code-trace/delta_test.go#L79), [`delta_test.go:87`](apps/lore-code-trace/delta_test.go#L87), [`ingest_test.go:13`](apps/lore-code-trace/ingest_test.go#L13), [`ingest_test.go:37`](apps/lore-code-trace/ingest_test.go#L37), [`ingest_test.go:52`](apps/lore-code-trace/ingest_test.go#L52), [`ingest_test.go:69`](apps/lore-code-trace/ingest_test.go#L69), [`ingest_test.go:99`](apps/lore-code-trace/ingest_test.go#L99), [`ingest_test.go:117`](apps/lore-code-trace/ingest_test.go#L117), [`ingest_test.go:164`](apps/lore-code-trace/ingest_test.go#L164), [`ingest_test.go:182`](apps/lore-code-trace/ingest_test.go#L182), [`ingest_test.go:201`](apps/lore-code-trace/ingest_test.go#L201), [`ingest_test.go:221`](apps/lore-code-trace/ingest_test.go#L221), [`ingest_test.go:240`](apps/lore-code-trace/ingest_test.go#L240), [`ingest_test.go:254`](apps/lore-code-trace/ingest_test.go#L254), [`ingest_test.go:279`](apps/lore-code-trace/ingest_test.go#L279), [`ingest_test.go:309`](apps/lore-code-trace/ingest_test.go#L309), [`ingest_test.go:337 362 385 403 `](apps/lore-code-trace/ingest_test.go#L337 362 385 403 ))

- **FR8 — the runner ingests specs and ADRs (lore-code-trace docs).** The `docs` subcommand runs FR5's handshake once per doc kind and posts the files' content inline, so lore-api projects them in-process and no pod clones the repository. ([validated by TestRunDocsPostsEverySpecAndADRWhenLoreHoldsNoState](apps/lore-code-trace/docs_run_test.go#L95))
  - With no recorded state, `docs --post` posts every tracked file of the kind with `base_commit: null`. ([validated by TestRunDocsPostsEverySpecAndADRWhenLoreHoldsNoState](apps/lore-code-trace/docs_run_test.go#L95), [validated by TestDocsFlowPostsEveryTrackedSpecWithNullBaseWhenNoStateIsRecorded](apps/lore-code-trace/docs_test.go#L114))
  - Against a reachable recorded commit it posts only the kind's files that `git diff --name-status <base>..HEAD` names as changed, and names the kind's deleted paths. ([validated by TestRunDocsPostsOnlyWhatChangedSinceTheStoredCommit](apps/lore-code-trace/docs_run_test.go#L118), [validated by TestDocsFlowSendsOnlyChangedAndDeletedSpecsAgainstAReachableBase](apps/lore-code-trace/docs_test.go#L142))
  - A push that changed no file of the kind still posts an empty delta, so the stored commit advances and the next diff stays short. ([validated by TestDocsFlowPostsAnEmptyDeltaWhenNoSpecChangedSoTheStateStillAdvances](apps/lore-code-trace/docs_test.go#L170))
  - A recorded commit the checkout cannot reach gets every file of the kind, with `base_commit` still the observed commit. ([validated by TestDocsFlowSendsFullContentButObservedBaseWhenTheBaseIsUnreachable](apps/lore-code-trace/docs_test.go#L186))
  - A diff that touches `.lore/ingest.yml` gets every file of the kind, because new patterns redefine which files belong to it. ([validated by TestDocsFlowSendsEverySpecWhenTheIngestManifestChanged](apps/lore-code-trace/docs_test.go#L205))
  - `--force` posts every file of the kind with `force: true`. ([validated by TestDocsFlowForcesEverySpecAndSaysSo](apps/lore-code-trace/docs_test.go#L224), [validated by TestParseArgsReadsTheSubcommandsAndTheirFlags](apps/lore-code-trace/docs_run_test.go#L243))
  - A kind's files are the markdown files under its built-in prefixes (`specs/` and `.specify/` for specs, `adrs/` for ADRs). ([validated by TestSelectDocPathsUsesTheKindPrefixesAndMarkdownOnly](apps/lore-code-trace/docs_test.go#L11))
  - A kind declared in `.lore/ingest.yml` is selected by its glob patterns instead, matched as the server's `matchesAnyGlob` matches them. ([validated by TestRunDocsSelectsByTheRepositorysIngestManifest](apps/lore-code-trace/docs_run_test.go#L146), [validated by TestSelectDocPathsLetsDeclaredPatternsReplaceThePrefixes](apps/lore-code-trace/docs_test.go#L31), [validated by TestParseIngestPatternsReadsGlobListsPerKind](apps/lore-code-trace/docs_test.go#L41), [validated by TestGlobMatch](apps/lore-code-trace/glob_test.go#L5))
  - An unparseable `.lore/ingest.yml` fails the run before anything is posted, because falling back to the built-in prefixes would select other files and a full ingest prunes what its selection leaves out. ([validated by TestParseIngestPatternsRefusesAnUnparseableManifest](apps/lore-code-trace/docs_test.go#L55), [validated by TestRunDocsPostsNothingWhenTheIngestManifestDoesNotParse](apps/lore-code-trace/docs_run_test.go#L165))
  - A full ingest carries `present`, every path of the kind the tree holds, with its last chunk only. ([validated by TestDocsFlowChunksAnOversizeIngestAndPrunesOnlyWithTheLastChunk](apps/lore-code-trace/docs_test.go#L257))
  - An ingest over the chunk budget rides FR3's `{seq, total}` envelope with the deleted paths on the first chunk only. ([validated by TestDocsFlowSendsDeletedPathsWithTheFirstChunkOnly](apps/lore-code-trace/docs_test.go#L295))
  - On a 409 the runner re-fetches the state and re-diffs exactly once. ([validated by TestDocsFlowRefetchesAndRediffsOnceOnAStaleBase](apps/lore-code-trace/docs_test.go#L321), [validated by TestDocsFlowGivesUpLoudlyAfterASecondStaleBase](apps/lore-code-trace/docs_test.go#L338))
  - A kind whose post fails is reported by name and the other kind is still posted. ([validated by TestRunDocsReportsAFailedKindAndStillPostsTheOther](apps/lore-code-trace/docs_run_test.go#L212))
  - `docs --post` refuses to run without `LORE_API_URL` and `LORE_INGEST_TOKEN`. ([validated by TestRunDocsPostRequiresTheAPIURLAndToken](apps/lore-code-trace/docs_run_test.go#L200))
  - Without `--post`, `docs` prints the files each kind selects and calls nothing. ([validated by TestRunDocsWithoutPostPrintsTheSelectionAndCallsNothing](apps/lore-code-trace/docs_run_test.go#L182))

- **FR9 — force and prune on a doc delta.** A doc delta's `force` and `present` fields ride FR3's body and are optional. ([validated by projects changed docs, prunes deleted ones, and advances the state](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L112))
  - `force: true` reaches the projector, which re-projects a file whose content hash is unchanged. ([validated by tells the projector to re-project when the delta is forced](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L416))
  - A delta carrying `present` prunes every doc of the kind the graph holds that `present` does not name. ([validated by prunes specs/gone/spec.md when the graph holds it and present does not](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L427), [validated by prunes adrs/ADR-009.md through the adr prune when present omits it](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L444))
  - The prune is refused, and the delta still succeeds, when it would remove more than 2 docs and more than half of what the graph holds. ([validated by prunes nothing when 5 of the graph's 6 specs are missing from present](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L461))
  - A forced delta prunes past that refusal. ([validated by prunes 5 of the graph's 6 specs when the delta is forced](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L493))
  - An empty `present` prunes nothing, forced or not: an empty tree is what a failed read looks like, so a kind's last document is removed by a diffed delta that names it as deleted. ([validated by prunes nothing when present is empty, forced or not](apps/lore-api/src/transport/routes/ingest/ingest-delta.test.ts#L477))

- **FR10 — the ingest workflow every onboarded repo installs posts docs as a delta.** Version 6 of `LORE_INGEST_WORKFLOW_CONTENT` (`libs/shared/src/work/ingest-workflow.ts`) replaces the `graph` job's `ingest-graph` POST, which started a pod per kind, with FR8's `lore-code-trace docs --post`. ([validated by projects specs and ADRs with lore-code-trace docs --post and no longer posts to ingest-graph](libs/shared/src/work/ingest-workflow.test.ts#L64))

## Planned (next slices)

The onboarding scaffold and the rollout are follow-up slices, specified here
so the routes above have their consumer named:

- **FR6 — onboarding scaffolds the incremental flow for tests.** The `onboard`
  task's generated `lore-tests.yml` workflow and the `LORE_TESTS_INSTRUCTION`
  prompt teach the handshake — state fetch, diff, JSON POST — instead of the
  retired chunk-webhook fan-out. (The docs half shipped as FR10.)

- **FR7 — the pod path retires.** Once onboarded repos post deltas, the
  `internal.ingest.spec_trace` payload-kind fan-out (one ingest assembly line
  and one pod per 512KB chunk) and the Floor `ci-tests` webhook ingress are
  removed; the ingest station keeps only what still needs a clone.
