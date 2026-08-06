# Future improvements backlog

A running list of known, deliberately-deferred refactors and tech-debt in the
spec-traceability / Dgraph projection subsystem (`libs/shared/src/spec-trace/`
and neighbours). These are out of scope for the change that logged them; each
line is a candidate cleanup, not a committed task. Entries name the file and the
smell, then the intended fix — usually "extract a shared primitive once a second
or third consumer appears."

project-spec-file.ts upsertByXid = one txn per node → N+1 round-trips, no cross-file atomicity; batch into a single upsert txn (needed anyway for pruning's consistent snapshot).
project-spec-file.ts newUid unguarded as string → returns undefined-as-string on a malformed mutate result, silently corrupting edges; add an enforce-style guard.
upsertByXid query-then-mutate isn't atomic under concurrent projections of the same xid → use a Dgraph upsert block.
Org-wide sha256 duplication (dgraph-memory-store.ts, spec-judge.ts, chunker.ts, + this file) → export one sha256/contentHash from shared.
xid |-join collision if repo/path contains | → document or encode the delimiter.
deleteRepoNodes test cleanup leaves orphan TestChunks (keyed repo|path|line, not reachable from Spec.repo) → add eq(TestChunk.repo,$repo).
withTxn/newUid duplicated vs private copies in dgraph-memory-store.ts → hoist to shared/src/dgraph-txn.ts when pruning needs them; reuse in the test harness too.
projectSections/projectAcceptanceCriteria parallel "collect uids → set forward Spec.<edge> if non-empty" → extract linkSpecCollection(context, forwardEdge, uids) when the section/AC prune facets land alongside.
TestChunk.test_name == link_label (same value, two predicates) → confirm intended divergence or drop one.
Module header doc still lists "idempotent re-projection pruning" as fully deferred though statement pruning ships → narrow it to Section/AC pruning.
live-Dgraph test harness (readGraph/deleteRepoNodes) local to one file → extract spec-trace/__tests__/dgraph-fixture.ts when the second live test file appears.
provenance.ts pairKey/VALIDATES_ANNOTATION_RE |-delimiter & \S+? split collide if a specPath contains | or # → key on JSON.stringify([specPath, ordinal]); anchor the ordinal capture.
Provenance parsers split across packages (annotation in agent, trailer in shared) → consider co-locating the three parsers behind one provenance-parsing module.
ProvenanceRef triple serialized in 3 places (trailer wire #/->, dedup | key, regexes) → one authoritative identity helper if a 4th appears.
commit-trailers.ts: formatTrailers lacks a doc comment; the module mixes pure parsing with git-I/O (lastStageOnBranch) → split the I/O edge if it grows.
commit-trailers.test.ts: formats extras after required keys uses individual expects → one toEqual([...]).
shared/src/index.ts is a 150-line god-barrel → split into per-domain sub-barrels.
N+1 queries in matchCoveredRanges (one query per covered range) → batch by distinct file path in one query.
Live-Dgraph test harness duplicated across ingest-coverage/verify-coverage/project-spec-file/provenance tests (reachability probe, schema applier, readGraph, repo cleanup, mutate seed helper) → extract a domain-named spec-trace/__tests__/dgraph-harness.ts fixture.
Unnamed coverage shapes — CoverageMeta {repo,tool,commit} / CoverageRecord {testFile,testName,covered} are inline on ingestCoverageReport → name them (ideally in @re-cinq/lore-shared beside CoveredChunk) so the route + CLI share one vocabulary.
Delete-then-set forward-[uid]-edge replacement now exists in replaceCovers (Coverage.covers) and is the planned approach for Section/AC pruning in project-spec-file.ts → extract a shared edge-replace primitive into dgraph-upsert.ts once the second instance lands.
withTxn/newUid still duplicated vs the private copies in shared/src/dgraph-memory-store.ts (memory bounded context) → promote a context-agnostic pair into @re-cinq/lore-shared on a third consumer.
verify-coverage.ts as StatementVerification cast trusts the query shape with no runtime guard → a thin narrowing helper if more read sites grow.
Classifier duplication — spec-blocks.ts inlines 4 line classifiers that overlap (but deliberately differ from) spec-segment.ts's private ones → promote to a shared spec-line-classifiers.ts only after ordered-list/CommonMark facets converge the rules.
N-Quad escaping (dgraph-upsert.ts setEmptyStrings) — safe today (hardcoded ""); needs a value-escaper if ever generalized to user text.
ingest-coverage N+1 / sequential awaits → batch file lookups + Promise.all independent records.
spec-trace query literals duplicated across files → a domain spec-trace/queries.ts.
projectChildren idiom — projectSections/projectAcceptanceCriteria/projectBlocks share a collect-then-upsert shape; collapse if a 4th appears.
live-Dgraph test harness duplicated across spec-trace test files → shared fixture.
parseSpecAnchor vs provenance.ts — same path#ordinal anchor concept in two modules → consolidate into one spec-anchor module both import.
schema-applier race — spec-trace live-Dgraph suites need --no-file-parallelism; move setup-spec-trace-schema.sh apply to vitest globalSetup.
spec-trace test-support dup — deleteRepoNodes/deleteStatementNode/readGraph + row-mapper shape copy-pasted across suites → one shared domain test fixture.
ingest-coverage.ts linkTestChunkCoverage/replaceCovers — both hand-roll the two-step "query uid then mutate edge" pattern → a setEdge/findUidBy primitive in dgraph-upsert.ts.
replaceCovers (ingest-coverage.ts) reimplements the <uid> <pred> * . clear → route through the new deletePredicate.
parseSpecAnchor (ingest-test-report) vs provenance.ts — duplicate anchor parsing; one authoritative parser.
SpecTraceNodeType JSDoc enumeration stale (omits Block/TestSuite).
Schema-applier race → vitest globalSetup; shared live-Dgraph teardown fixture.
toVecLiteral vs toVectorLiteral naming drift.
Drift-clearing — a re-verification concern that belongs to coverage/test re-ingest (like violated-clearing), not a driftCheckFile re-run; clearing on hash-match would make drift wrongly transient.
Link-rot-vs-content precedence & max-severity-across-chunks — order-dependent edge-case refinements (F-severity-policy).
coverage-bridged / llm-suggested producers (ranked in the ladder, no populator; the latter is T252) and generated-provenance plumbing from real commit sources (the model supports it — a provenance pass calls upsertTraceLink(generated-provenance) and projectTraceLinks won't downgrade it).
