# Data Model: Spec Traceability Graph

A **reversible projection** in the shared Dgraph cluster (see
[`memory-dgraph-migration/data-model.md`](../memory-dgraph-migration/data-model.md)
for the cluster, client, and vector conventions). Markdown stays the
source of truth; these nodes are rebuilt from segmentation + parsed links
+ AST chunks + coverage on every ingest. Deleting the whole graph and
re-running the units reproduces it exactly — **and** the inverse holds:
`recomputeSpecFile()` walks the graph back to a `spec.md` that hashes to
the same `Spec.content_hash` it was projected from (round-trip invariant).
The projection is lossless by construction, not by promise.

Everything is rooted at a single **`Repo`** node (`xid = org/name`): every
`Spec`, `ADR`, `CodeChunk`, `TestChunk`, and `Coverage` hangs off it, so a
repo's entire traceability surface is one traversal from the root. The
scalar `*.repo` string predicates are kept as a denormalized fast-filter
mirror of `Repo.xid` (indexed lookups don't pay a traversal).

Every node carries a deterministic `xid` (`@index(hash) @upsert`) so the
projection is idempotent. `CodeChunk`/`TestChunk` mirror Postgres
`{team}.chunks` rows (keyed by the chunk UUID) and carry their
`content_hash` (the drift substrate) and embedding (mirrored, for
`similar_to`).

## Type system

```
type Repo       { Repo.xid Repo.name
                  Repo.specs Repo.adrs Repo.code_chunks
                  Repo.test_chunks Repo.test_suites Repo.coverage }
type Spec       { Spec.xid Spec.repo Spec.file_path Spec.content_hash
                  Spec.blocks Spec.sections Spec.acceptance_criteria }
type Block      { Block.xid Block.spec Block.repo Block.file_path
                  Block.ordinal Block.kind Block.text Block.level }
type Section    { Section.xid Section.spec Section.heading Section.level
                  Section.ordinal Section.statements }
type AcceptanceCriterion { AcceptanceCriterion.xid AcceptanceCriterion.spec
                  AcceptanceCriterion.ordinal AcceptanceCriterion.label
                  AcceptanceCriterion.text AcceptanceCriterion.text_hash
                  AcceptanceCriterion.embedding
                  AcceptanceCriterion.validated_by AcceptanceCriterion.implemented_by
                  AcceptanceCriterion.decided_by
                  AcceptanceCriterion.drifted AcceptanceCriterion.drift_reason
                  AcceptanceCriterion.violated AcceptanceCriterion.violation_reason }
type ADR        { ADR.xid ADR.repo ADR.number ADR.title ADR.status
                  ADR.file_path ADR.content_hash ADR.embedding ADR.supersedes }
type Statement  { Statement.xid Statement.spec Statement.section Statement.ordinal
                  Statement.text Statement.text_hash Statement.kind
                  Statement.testability Statement.category
                  Statement.embedding
                  Statement.validated_by Statement.implemented_by Statement.decided_by
                  Statement.drifted Statement.drift_reason
                  Statement.violated Statement.violation_reason }
type CodeChunk  { CodeChunk.xid CodeChunk.repo CodeChunk.file_path
                  CodeChunk.symbol_name CodeChunk.symbol_type
                  CodeChunk.start_line CodeChunk.end_line
                  CodeChunk.content_hash CodeChunk.chunk_id CodeChunk.embedding }
type TestChunk  { TestChunk.xid TestChunk.repo TestChunk.file_path
                  TestChunk.test_name TestChunk.symbol_name TestChunk.link_label
                  TestChunk.start_line TestChunk.end_line
                  TestChunk.content_hash TestChunk.chunk_id TestChunk.embedding
                  TestChunk.coverage TestChunk.suite }
type TestSuite  { TestSuite.xid TestSuite.repo TestSuite.name TestSuite.file_path
                  TestSuite.parent TestSuite.spec }
type Coverage   { Coverage.xid Coverage.test Coverage.repo Coverage.tool
                  Coverage.commit Coverage.generated_at Coverage.line_count
                  Coverage.covers }
type File       { File.xid File.repo File.path }
```

`File` is the **coverage-source aggregation** node — one per `(repo, path)`.
Coverage no longer mints a `CodeChunk` per covered range (that exploded the
node count); instead `Coverage.covers` targets a single `File` per covered file,
and the covered line intervals ride the edge as a `Coverage.covers|ranges` string
facet (`"12-18,30-40"`). The graph viz shows File nodes, not the range swarm.
A `File` is GC'd when no `Coverage` still covers it.

### Edges (and their meaning)

| Predicate | From → To | Meaning |
|---|---|---|
| `Repo.specs` / `Spec.repo` | Repo ↔ Spec | `IN_REPO` (root → spec) |
| `Repo.adrs` | Repo → ADR | `IN_REPO` (root → ADR) |
| `Repo.code_chunks` / `Repo.test_chunks` / `Repo.test_suites` / `Repo.coverage` / `Repo.files` | Repo → CodeChunk \| TestChunk \| TestSuite \| Coverage \| File | `IN_REPO` (root → chunk/suite/coverage/file) |
| `Spec.feature` | Spec → Feature | `IN_FEATURE` — groups the many md files of one speckit folder (`specs/<name>/spec.md`, `plan.md`, `data-model.md`, …) under a single node (reverse `~Spec.feature` = the feature's specs) |
| `Spec.blocks` / `Block.spec` | Spec ↔ Block | `IN_SPEC` (the **lossless source layer** — every block of the markdown in document order; reconstruction reads these) |
| `Spec.sections` / `Section.spec` | Spec ↔ Section | `IN_SPEC` |
| `Spec.acceptance_criteria` / `AcceptanceCriterion.spec` | Spec ↔ AcceptanceCriterion | `IN_SPEC` (the testable contract, hung directly off the spec — not nested in a Section) |
| `Section.statements` / `Statement.section` | Section ↔ Statement | `IN_SECTION` |
| `Statement.validated_by` / `AcceptanceCriterion.validated_by` | Statement \| AcceptanceCriterion → TestChunk | `VALIDATED_BY` (test asserts the sentence) |
| `Statement.implemented_by` / `AcceptanceCriterion.implemented_by` | Statement \| AcceptanceCriterion → CodeChunk | `IMPLEMENTED_BY` (code realizes the sentence) — carries `evidence` |
| `Statement.decided_by` / `AcceptanceCriterion.decided_by` | Statement \| AcceptanceCriterion → ADR | `DECIDED_BY` (the decision the clause rests on — answers "why is this here") |
| `ADR.supersedes` | ADR → ADR | `SUPERSEDES` (MADR lifecycle; reverse = superseded_by) |
| `TestChunk.coverage` | TestChunk → Coverage | `HAS_COVERAGE` |
| `TestChunk.suite` | TestChunk → TestSuite | `IN_SUITE` (test's innermost suite; reverse = the suite's tests) |
| `TestSuite.parent` | TestSuite → TestSuite | `PARENT_SUITE` (suite nesting; reverse = child suites; root/file-level suites have none) |
| `TestSuite.spec` | TestSuite → Spec | `VALIDATES_SPEC` (a whole suite declared against a spec — the suite-level analog of `VALIDATED_BY`; reverse = the spec's suites) |
| `Coverage.covers` | Coverage → File | `COVERS` (execution proof) — the covered line intervals are a `Coverage.covers|ranges` edge **facet** ("12-18,30-40"), not per-range nodes |

## Predicate & index definitions

```dql
Spec.xid: string @index(hash) @upsert .
Section.xid: string @index(hash) @upsert .
Statement.xid: string @index(hash) @upsert .
CodeChunk.xid: string @index(hash) @upsert .
TestChunk.xid: string @index(hash) @upsert .
Coverage.xid: string @index(hash) @upsert .
AcceptanceCriterion.xid: string @index(hash) @upsert .
Repo.xid: string @index(hash) @upsert .
ADR.xid:  string @index(hash) @upsert .
TestSuite.xid: string @index(hash) @upsert .
Block.xid: string @index(hash) @upsert .
Feature.xid: string @index(hash) @upsert .
File.xid: string @index(hash) @upsert .

# Repo (root — every other node is reachable from here)
Repo.name:            string @index(hash) .          # org/name
Repo.specs:           [uid] @reverse @count .
Repo.adrs:            [uid] @reverse @count .
Repo.code_chunks:     [uid] @reverse @count .
Repo.test_chunks:     [uid] @reverse @count .
Repo.test_suites:     [uid] @reverse @count .
Repo.coverage:        [uid] @reverse @count .
Repo.files:           [uid] @reverse @count .

# Feature (one per speckit folder under specs/ — the UI grouping node)
Feature.repo:         string @index(hash) .
Feature.path:         string @index(hash) .          # e.g. specs/spec-traceability-graph
Feature.title:        string .                        # folder basename

# Spec / Section
Spec.repo:            string @index(hash) .
Spec.file_path:       string @index(hash) .
Spec.content_hash:    string .                       # projection freshness gate
Spec.feature:         uid @reverse .                  # the feature folder this md belongs to
Spec.blocks:          [uid] @reverse @count .
Spec.sections:        [uid] @reverse @count .
Spec.acceptance_criteria: [uid] @reverse @count .

# Block (lossless source layer — the document as an ordered, verbatim block stream)
Block.spec:           uid @reverse .                  # set for Spec docs (traversal); ADRs have none
Block.repo:           string @index(hash) .
Block.file_path:      string @index(hash) .           # the document this block belongs to — reconstruction key
Block.ordinal:        int .                           # document-global block position (total order)
Block.kind:           string @index(hash) .           # heading|paragraph|list-item|code|table|blank
Block.text:           string .                         # VERBATIM source for this block
Block.level:          int .                            # heading depth where kind=heading
Section.spec:         uid @reverse .
Section.heading:      string @index(term) .
Section.level:        int .                          # heading depth (# = 1) — for recompute
Section.ordinal:      int .                           # document-global position (total order)
Section.statements:   [uid] @reverse @count .

# AcceptanceCriterion (testable contract, child of Spec — parallel to Section)
AcceptanceCriterion.repo:        string @index(hash) .
AcceptanceCriterion.spec:        uid @reverse .
AcceptanceCriterion.ordinal:     int @index(int) .   # the numbered list position
AcceptanceCriterion.label:       string .            # author's "AC1" / list marker, if any
AcceptanceCriterion.text:        string @index(fulltext) .
AcceptanceCriterion.text_hash:   string .            # detects a reworded criterion
AcceptanceCriterion.embedding:   float32vector @index(hnsw(metric:"cosine")) .
AcceptanceCriterion.validated_by:   [uid] @reverse @count .
AcceptanceCriterion.implemented_by: [uid] @reverse @count .
AcceptanceCriterion.decided_by:     [uid] @reverse @count .
AcceptanceCriterion.drifted:     bool @index(bool) .
AcceptanceCriterion.drift_reason: string .
AcceptanceCriterion.violated:    bool @index(bool) .   # a validating test currently FAILS (project-test-interface)
AcceptanceCriterion.violation_reason: string .

# Statement
Statement.repo:        string @index(hash) .
Statement.spec:        uid @reverse .
Statement.section:     uid @reverse .
Statement.ordinal:     int @index(int) .
Statement.text:        string @index(fulltext) .
Statement.text_hash:   string .                      # detects a reworded sentence
Statement.kind:        string @index(hash) .         # sentence | list-item
Statement.testability: string @index(hash) .         # testable | untestable
Statement.category:    string .                      # intro|vision|… (untestable bucket)
Statement.embedding:   float32vector @index(hnsw(metric:"cosine")) .
Statement.validated_by:   [uid] @reverse @count .
Statement.implemented_by: [uid] @reverse @count .
Statement.decided_by:     [uid] @reverse @count .
Statement.drifted:     bool @index(bool) .
Statement.drift_reason: string .
Statement.violated:    bool @index(bool) .           # a validating test currently FAILS (project-test-interface)
Statement.violation_reason: string .

# CodeChunk / TestChunk
CodeChunk.repo:         string @index(hash) .
CodeChunk.file_path:    string @index(hash) .
CodeChunk.symbol_name:  string @index(term) .
CodeChunk.start_line:   int .
CodeChunk.end_line:     int .
CodeChunk.content_hash: string @index(hash) .        # drift substrate
CodeChunk.embedding:    float32vector @index(hnsw(metric:"cosine")) .

TestChunk.repo:         string @index(hash) .
TestChunk.file_path:    string @index(hash) .
TestChunk.test_name:    string @index(term) .        # it()/test()/func Test… title
TestChunk.symbol_name:  string @index(term) .
TestChunk.link_label:   string .                     # author's markdown label
TestChunk.start_line:   int .
TestChunk.end_line:     int .
TestChunk.content_hash: string @index(hash) .
TestChunk.embedding:    float32vector @index(hnsw(metric:"cosine")) .
TestChunk.coverage:     uid @reverse .
TestChunk.suite:        uid @reverse .                # innermost enclosing suite

# TestSuite (describe block / class / file-level grouping; nests via parent)
TestSuite.repo:         string @index(hash) .
TestSuite.name:         string @index(term) .         # the describe()/class title; file basename for the root
TestSuite.file_path:    string @index(hash) .
TestSuite.parent:       uid @reverse .                # enclosing suite; reverse = child suites
TestSuite.spec:         uid @reverse .                # optional: a Spec this suite is declared against

# Coverage
Coverage.test:          uid @reverse .
Coverage.repo:          string @index(hash) .
Coverage.tool:          string @index(hash) .        # lcov | cobertura | go-cover
Coverage.commit:        string @index(hash) .        # idempotency key component
Coverage.generated_at:  dateTime @index(hour) .       # filter/sort coverage by recency
Coverage.line_count:    int .
Coverage.covers:        [uid] @reverse @count .

# ADR (MADR decision records — the "why" behind statements/criteria)
ADR.repo:               string @index(hash) .
ADR.number:             int @index(int) .             # ADR-016 → 16
ADR.title:              string @index(term) .
ADR.status:             string @index(hash) .         # proposed | accepted | superseded | deprecated
ADR.file_path:          string @index(hash) .
ADR.content_hash:       string .                      # drift substrate (decision text changed)
ADR.embedding:          float32vector @index(hnsw(metric:"cosine")) .
ADR.supersedes:         [uid] @reverse @count .        # reverse = superseded_by
```

## Call graph (cross-file symbol references)

The schema declares `CodeChunk.references` and `CodeChunk.imports` as reversible uid list predicates (`[uid] @reverse @count`). ([validated by declares CodeChunk.references and CodeChunk.imports as uid list predicates for the call graph](libs/shared/src/outbound/setup-spec-trace-schema.test.ts#L167))

`lore-query-trace` routes a `callers_of` query to a callers endpoint rather than the trace/document endpoint. ([validated by routes a callers_of query to a callers endpoint rather than the document endpoint](libs/server-core/src/work/spec-trace/query-trace.test.ts#L286))

Statements reached via `~CodeChunk.references` are annotated `indirect` and rendered at `notice` annotation level rather than `warning` in the PR diff comment. ([validated by renders indirect statements as notice-level rather than warning so they appear in a quieter PR section](libs/shared/src/work/spec-trace/trace-impact.test.ts#L126), [validated by surfaces a caller statement as indirect when only the callee chunk is changed](libs/shared/src/work/spec-trace/trace-impact.test.ts#L474))

The reference extractor identifies imported symbols that are actually called in a TypeScript/JavaScript source file and returns their names paired with the module path they were imported from. ([validated by returns imported symbol names and their source paths when those symbols are called in a TypeScript source file](libs/shared/src/work/spec-trace/reference-extractor.test.ts#L5), [validated by omits imported symbols that are never called in the file](libs/shared/src/work/spec-trace/reference-extractor.test.ts#L28), [validated by returns an empty array for a file with no import declarations](libs/shared/src/work/spec-trace/reference-extractor.test.ts#L44))

## Branch overlay

The graph describes one snapshot of `main`. An implementation run makes many
pushes to one branch before any of them merge, so a run that asked the graph
about its own work got `main`'s answer. A **branch overlay** closes that gap:
a namespaced set of chunk/test/coverage nodes keyed on the branch, written at
each branch push and dropped when the branch's PR closes. It is keyed on the
branch rather than on an assembly run because a pod can always name its branch
and can never learn its run id, and because every run on a PR's head branch —
implementation, review, triage, reply — describes the same code. It is unioned
over `main` at read time; `main` itself is never written by a branch.

A projection writes into a **scope**, which owns three things: the xid prefix,
the `.repo` scalar its nodes carry, and the root node they hang off. On `main`
the scope key is the bare repo and the root is the `Repo` node. ([validated by keys on the bare repo and roots at Repo](libs/shared/src/domain/spec-trace/trace-scope.test.ts#L12), [validated by returns false from isOverlay](libs/shared/src/domain/spec-trace/trace-scope.test.ts#L20))

An overlay scope inserts a `branch:<name>` segment between the repo and the
path, and roots at the branch's `Overlay` node. ([validated by inserts a branch segment between the repo and the path and roots at Overlay](libs/shared/src/domain/spec-trace/trace-scope.test.ts#L26), [validated by returns true from isOverlay](libs/shared/src/domain/spec-trace/trace-scope.test.ts#L35))

Because the branch segment is part of the xid, a branch's node for a path
upserts independently of `main`'s node for the same path instead of overwriting
it. ([validated by joins parts onto the main key with a pipe](libs/shared/src/domain/spec-trace/trace-scope.test.ts#L60), [validated by joins parts onto the overlay key so main and overlay never collide](libs/shared/src/domain/spec-trace/trace-scope.test.ts#L66), [validated by joins several parts in order](libs/shared/src/domain/spec-trace/trace-scope.test.ts#L72))

The root-edge predicate a scope attaches its chunks to is named for its root
type, so the same projection code hangs nodes off `Repo` on `main` and off
`Overlay` on a branch. ([validated by names the Repo predicate for a main scope](libs/shared/src/domain/spec-trace/trace-scope.test.ts#L80), [validated by names the Overlay predicate for an overlay scope](libs/shared/src/domain/spec-trace/trace-scope.test.ts#L86))

`Overlay.xid` is a hash upsert index and `Overlay.branch` /
`Overlay.head_commit` are indexed, so a branch's overlay is found by name and
the commit its ranges are expressed in is queryable. ([validated by declares Overlay.xid as a hash upsert index so a branch's overlay upserts independently of main](libs/shared/src/outbound/setup-spec-trace-schema.test.ts#L205))

The `Overlay` node carries the same chunk container edges the `Repo` root does —
`test_chunks`, `code_chunks`, `coverage`, `files` — as reversible uid lists. ([validated by declares the Overlay chunk edges as uid lists so a branch's nodes hang off it instead of the Repo root](libs/shared/src/outbound/setup-spec-trace-schema.test.ts#L219))

### Which branch is an overlay

A report names the branch it was built on, but only the ingress that receives it
can learn the repo's default branch — so the ingress decides, with one shared
rule, and hands the ingest an explicit overlay branch. A report for any branch
other than the default one is an overlay. ([validated by returns feat/x when the report names feat/x and the default branch is main](libs/shared/src/domain/spec-trace/trace-scope.test.ts#L41))

A report for the default branch is `main`'s, whatever the default is called. ([validated by returns undefined when the report names the default branch](libs/shared/src/domain/spec-trace/trace-scope.test.ts#L45))

A detached `HEAD` names a commit rather than a branch, and a report naming no
branch names nothing; both are `main`'s. ([validated by returns undefined for a detached HEAD](libs/shared/src/domain/spec-trace/trace-scope.test.ts#L49), [validated by returns undefined when the report names no branch](libs/shared/src/domain/spec-trace/trace-scope.test.ts#L53))

### Anchor and lifecycle

The overlay anchor records the branch and the head commit its line numbers are
expressed in — the overlay's answer to `Repo.trace_commit`. ([validated by reads back the branch and head commit an upserted overlay was stamped with](libs/shared/src/work/spec-trace/overlay.test.ts#L40))

A branch that never wrote one reads back as absent rather than as an error. ([validated by returns null for a branch that never wrote an overlay](libs/shared/src/work/spec-trace/overlay.test.ts#L57))

A second push to the same branch restamps the existing anchor rather than adding
a second overlay — and every run on the branch pushes to that one anchor. ([validated by restamps head commit on a second push to the branch rather than creating a second overlay](libs/shared/src/work/spec-trace/overlay.test.ts#L63))

Dropping an overlay deletes every node it anchors and the anchor itself, so a
closed branch leaves nothing behind. ([validated by deletes the anchored chunks and the anchor, leaving no overlay for the branch](libs/shared/src/work/spec-trace/overlay.test.ts#L77))

The drop is safe to repeat: a branch with no overlay drops nothing and reports
zero. ([validated by drops nothing and reports zero for a branch with no overlay](libs/shared/src/work/spec-trace/overlay.test.ts#L104))

Listing overlays is scoped to one repo, so a sweep for one repo's abandoned
branches never sees another's. ([validated by lists only the overlays of the repo it was asked about](libs/shared/src/work/spec-trace/overlay.test.ts#L110))

### What an overlay ingest writes

A test report that names an overlay branch writes its chunks under the
branch-scoped key, and a query filtered on the bare repo key does not see them. ([validated by writes the branch's test chunks under the branch-scoped key, not the repo key](libs/shared/src/work/spec-trace/ingest-overlay.test.ts#L86))

The ingest stamps the branch's overlay with the head commit the report was
posted for. ([validated by stamps the overlay with the branch and head commit the report was posted for](libs/shared/src/work/spec-trace/ingest-overlay.test.ts#L97))

A branch push leaves `Repo.trace_commit` alone, so it cannot move the coordinate
system the pre-merge impact query is expressed in. ([validated by leaves Repo.trace_commit alone so a branch push cannot move main's coordinate system](libs/shared/src/work/spec-trace/ingest-overlay.test.ts#L110))

Specs, acceptance criteria and ADRs are never overlaid: the spec is the thing
the branch is measured against. An overlay ingest therefore writes no
`validated_by` onto the `main` statement a branch test claims — an unmerged
branch must not change what `main` claims to have proved. ([validated by writes no validated_by onto the main statement the branch test claims](libs/shared/src/work/spec-trace/ingest-overlay.test.ts#L126))

A report that names a branch but no overlay branch is unchanged: it writes
`main`'s chunks and stamps `main`'s baseline exactly as before. That is what
keeps the main-only incremental ingest, whose reports always name their branch,
on `main`. ([validated by still writes main's test chunks and baseline when the report names a branch but no overlay branch](libs/shared/src/work/spec-trace/ingest-overlay.test.ts#L146))

### Reading coverage as the branch sees it

`tests_covering(file, range)` answers which tests exercise a span — the question
a `tdd-round` asks before it edits a symbol, so that when the suite goes red it
can tell the test it just wrote from a regression it just caused.

Coverage is aggregated per test FILE at ingest, so the answer names test files
rather than individual `it()` blocks. A record is returned when its covered
intervals overlap the asked-about range. ([validated by returns the test whose coverage overlaps the asked-about line range](libs/shared/src/outbound/spec-trace/tests-covering.test.ts#L91))

A range no coverage record touches returns nothing rather than falling back to
the whole file. ([validated by returns nothing for a range no test covers](libs/shared/src/outbound/spec-trace/tests-covering.test.ts#L104))

Asking about a file without narrowing to a range returns every test file that
covers it. ([validated by returns every covering test when no range narrows the question](libs/shared/src/outbound/spec-trace/tests-covering.test.ts#L117))

Inside a branch's overlay the same question is answered from the branch's own
coverage, tagged as coming from the overlay. ([validated by reads the branch's own coverage from the branch scope and marks it as overlay](libs/shared/src/outbound/spec-trace/tests-covering.test.ts#L127))

That branch coverage is invisible from the main scope, so a branch in flight cannot
change what anyone else is told. ([validated by does not see the branch's coverage from the main scope](libs/shared/src/outbound/spec-trace/tests-covering.test.ts#L141))

The overlay's answer REPLACES main's for a file the branch covers; a file the
branch never touched falls through to main, and a file neither covers returns
nothing. ([validated by replaces main's answer for the file when the overlay covers it](libs/shared/src/outbound/spec-trace/tests-covering.test.ts#L31), [validated by falls through to main for a file the branch never touched](libs/shared/src/outbound/spec-trace/tests-covering.test.ts#L35), [validated by returns nothing when neither scope covers the file](libs/shared/src/outbound/spec-trace/tests-covering.test.ts#L39))

### Ending a branch's overlay

The Floor never writes Dgraph itself, so a closing PR does not delete its
branch's overlay directly: the Floor emits the same `internal.ingest.spec_trace`
event a test report rides, with kind `overlay-drop` naming the PR's repo and
head branch, and the ingest station performs the delete. ([validated by asks the ingest to drop the feat/x overlay when the merged feat/x PR closes](apps/floor/src/work/assembly-run/drop-overlay.test.ts#L18))

The drop follows the PR, not a run: review, triage and reply runs all work on
the PR's head branch, so the first of them to finish would otherwise wipe an
overlay the implementation loop is still writing. A PR closed without merging
drops its overlay the same way. ([validated by asks for the same drop when the feat/x PR closes unmerged](apps/floor/src/work/assembly-run/drop-overlay.test.ts#L39))

A closed PR that names no head branch asks for nothing. ([validated by asks for nothing when the closed PR names no head branch](apps/floor/src/work/assembly-run/drop-overlay.test.ts#L50))

The drop can still be missed — a branch that never opened a PR, a lost event —
so a retention sweep reaps every overlay a repo has not restamped since a
cutoff. A branch still pushing restamps its own anchor on every push, so an old
stamp means nobody is. ([validated by drops an overlay written before the cutoff](libs/shared/src/work/spec-trace/overlay.test.ts#L162))

An overlay stamped after the cutoff is kept, because its branch may still be
pushing. ([validated by keeps an overlay written after the cutoff, because its branch may still be pushing](libs/shared/src/work/spec-trace/overlay.test.ts#L176))

## Failures

`fix-ci` gets three attempts per ticket and every one of them starts cold, with
no idea that this exact error in this exact file has been fixed before. The
`pipeline.station_runs` row already records what failed; what was missing was a
join from that record to the files it names. A **`Failure` node** supplies it:
one per station-run attempt, edged to the files and code chunks its output
implicated, carrying the sha of the attempt that later went green.

### Reading a file out of tool output

The parse is deterministic and covers the tools the validate step actually runs.
A `tsc` diagnostic yields its file and line in both the parenthesized and the
colon form. ([validated by returns src/foo.ts line 12 for a tsc parenthesized diagnostic](libs/shared/src/work/spec-trace/failure-sites.test.ts#L5), [validated by returns src/foo.ts line 12 for the tsc colon diagnostic variant](libs/shared/src/work/spec-trace/failure-sites.test.ts#L13))

An eslint stylish block attributes its indented rows to the bare path header
above them, and switches file when the next header appears. ([validated by attributes eslint stylish rows to the bare path header above them](libs/shared/src/work/spec-trace/failure-sites.test.ts#L21), [validated by switches file when a second eslint stylish path header appears](libs/shared/src/work/spec-trace/failure-sites.test.ts#L35))

The eslint compact form, a go test failure block, a go build diagnostic, a
vitest `FAIL` header and a stack frame inside parentheses each yield their file. ([validated by returns src/foo.ts line 12 for an eslint compact/unix row](libs/shared/src/work/spec-trace/failure-sites.test.ts#L49), [validated by returns foo_test.go line 42 for a go test failure block](libs/shared/src/work/spec-trace/failure-sites.test.ts#L55), [validated by returns ./pkg/foo.go line 12 for a go build diagnostic](libs/shared/src/work/spec-trace/failure-sites.test.ts#L66), [validated by returns the vitest FAIL header file with no line](libs/shared/src/work/spec-trace/failure-sites.test.ts#L72), [validated by returns src/foo.ts line 12 for a stack frame inside parentheses](libs/shared/src/work/spec-trace/failure-sites.test.ts#L78))

Frames inside `node_modules` are dropped, and so is any path whose extension is
not a supported source extension — the graph is intra-repo, and a dependency's
internals implicate nothing anyone here can fix. ([validated by drops frames inside node_modules](libs/shared/src/work/spec-trace/failure-sites.test.ts#L84), [validated by drops a path whose extension is not a supported source extension](libs/shared/src/work/spec-trace/failure-sites.test.ts#L95))

One path reported at two different lines is two sites; the same path and line
reported twice is one. ([validated by returns two entries for one path reported at two different lines](libs/shared/src/work/spec-trace/failure-sites.test.ts#L99), [validated by returns one entry for the same path and line reported twice](libs/shared/src/work/spec-trace/failure-sites.test.ts#L108))

Output naming no file yields nothing rather than throwing, whether it is empty,
prose, or not a string at all. ([validated by returns an empty array for an empty string](libs/shared/src/work/spec-trace/failure-sites.test.ts#L116), [validated by returns an empty array for prose naming no file](libs/shared/src/work/spec-trace/failure-sites.test.ts#L120), [validated by returns an empty array for a non-string input](libs/shared/src/work/spec-trace/failure-sites.test.ts#L126))

### Which failures name code

The failure taxonomy is infra-shaped and has no code class, so a validate, lint,
typecheck or test failure arrives as `unknown`. Only `unknown` — and a failure
predating the taxonomy — can implicate a file. ([validated by returns true for unknown](libs/shared/src/work/spec-trace/failure-sites.test.ts#L132), [validated by returns true for null and undefined](libs/shared/src/work/spec-trace/failure-sites.test.ts#L136))

Every explicitly infra or account class implicates no file, and a class outside
the taxonomy fails closed. ([validated by returns false for every infra or account failure class](libs/shared/src/work/spec-trace/failure-sites.test.ts#L141), [validated by returns false for a class outside the taxonomy](libs/shared/src/work/spec-trace/failure-sites.test.ts#L156))

### The node

A typecheck failure projects one `Failure` edged to the file its output named, ([validated by projects a typecheck failure with an edge to the file its output named](libs/shared/src/work/spec-trace/failure-nodes.test.ts#L55))

A query for that file returns it. ([validated by returns the projected failure to a query for the file it named](libs/shared/src/work/spec-trace/failure-nodes.test.ts#L65))

An infra failure projects nothing. ([validated by projects nothing for an infra failure, which implicates no file](libs/shared/src/work/spec-trace/failure-nodes.test.ts#L84))

So does a code-class failure whose output names no file: a `Failure` joined to
nothing would be noise in every later query. ([validated by projects nothing for a code-class failure whose output names no file](libs/shared/src/work/spec-trace/failure-nodes.test.ts#L96))

Where a code chunk's line range contains the failing line, the failure is edged
to the chunk as well as the file. ([validated by links the code chunk whose line range contains the failing line](libs/shared/src/work/spec-trace/failure-nodes.test.ts#L108))

The node is keyed on the station-run attempt, so a redelivered terminal event
updates one failure rather than creating a second. ([validated by re-projecting the same station run leaves one failure, not two](libs/shared/src/work/spec-trace/failure-nodes.test.ts#L123))

A file no failure ever named returns nothing. ([validated by returns nothing for a file no failure ever named](libs/shared/src/work/spec-trace/failure-nodes.test.ts#L135))

### Resolution

When a later attempt on the same node succeeds, its sha is stamped onto the
failures the earlier attempts left. The pair — what failed, and the commit that
ended it — is what a future `fix-ci` actually wants; the DIFF is never stored,
because the agent can `git show` the sha. ([validated by stamps the sha of the attempt that went green onto the earlier failure](libs/shared/src/work/spec-trace/failure-nodes.test.ts#L151))

A run that left no failure on that node has nothing to stamp. ([validated by stamps nothing when the run had no failure on that node](libs/shared/src/work/spec-trace/failure-nodes.test.ts#L169))

Failures older than the retention cutoff are reaped; past that the retrospective
episode carries the lesson in prose. ([validated by drops a failure older than the cutoff and keeps a newer one](libs/shared/src/work/spec-trace/failure-nodes.test.ts#L186))

### How it reaches the graph

The Floor never writes Dgraph itself, so a settled node emits an ingest event
carrying its outcome, and the graph decides from that outcome whether to project
a failure or resolve earlier ones. ([validated by carries the settled node and its outcome on the ingest lane](apps/floor/src/work/assembly-run/node-outcome-event.test.ts#L28))

The event takes the node's IDENTITY from its station-run row and its VERDICT
from the delivery. It cannot take the verdict from the row: the row is read
BEFORE the finish writes the outcome onto it, so its failure fields are still
empty at that moment. Reading them there would have projected every failure with
no detail, and a failure with no detail names no file, and a failure that names
no file is not projected at all — the whole feature would have been silently
inert. ([validated by takes identity from the row and the failure from the verdict](apps/floor/src/work/assembly-run/node-outcome-event.test.ts#L28), [validated by hands the graph the delivery's failure detail, not the row read before the finish wrote it](apps/floor/src/work/assembly-run/finish-node.test.ts#L787))

A verdict that names no failure carries nulls rather than omitting the fields, so
a resolve is distinguishable from a malformed record. ([validated by carries nulls for a verdict that names no failure](apps/floor/src/work/assembly-run/node-outcome-event.test.ts#L61))

A success and a failure on the same station run are keyed separately, so
recording one never suppresses the other. ([validated by keys a success separately from the failure on the same station run](apps/floor/src/work/assembly-run/node-outcome-event.test.ts#L75))

A run with a repo is recorded; a run without one is not, because its files
belong to nothing. ([validated by records for a run that names a repo](apps/floor/src/work/assembly-run/node-outcome-event.test.ts#L18), [validated by refuses for a run with no repo, whose files belong to nothing](apps/floor/src/work/assembly-run/node-outcome-event.test.ts#L22))

The ingest lane records a failed node against the file its output named. ([validated by records a failed node against the file its output named](libs/shared/src/work/spec-trace/ingest-failure-kind.test.ts#L49))

The instant a failure happened crosses that lane as an ISO string, not a Date,
because the payload is JSON — so the projection accepts either and normalizes. ([validated by records a failure whose occurredAt crossed the ingest JSON as a string](libs/shared/src/work/spec-trace/ingest-failure-kind.test.ts#L83))

It writes no overlay while doing so: a failure is a fact about the repo's
history that outlives the run, not a branch snapshot. ([validated by writes no overlay for a failure, which is a fact about the repo and not a branch snapshot](libs/shared/src/work/spec-trace/ingest-failure-kind.test.ts#L59))

A later success on the same node stamps the resolving sha. ([validated by stamps the resolving sha when a later attempt on the same node succeeds](libs/shared/src/work/spec-trace/ingest-failure-kind.test.ts#L67))

### Retention

Overlays and failures are both run-scoped, so they age out on the same window
the run's telemetry keeps: fourteen days. ([validated by defaults to the same fourteen days the run telemetry keeps](libs/shared/src/work/spec-trace/graph-retention.test.ts#L34))

The cutoff is that window before the instant the reap runs. ([validated by is the retention window before the given instant](libs/shared/src/work/spec-trace/graph-retention.test.ts#L28))

One pass reaps both kinds for a repo. ([validated by reaps an expired overlay and an expired failure in one pass](libs/shared/src/work/spec-trace/graph-retention.test.ts#L51))

Anything inside the window is left alone — an overlay there may belong to a run
still pushing. ([validated by leaves an overlay and a failure inside the window alone](libs/shared/src/work/spec-trace/graph-retention.test.ts#L76))

The reap rides the ingest that already holds a graph client for the repo rather
than a cron nobody wires. That is deliberate: `agent_run_events.pruneOld` shipped
with no caller and pruned nothing for a release, and a prune whose only caller is
a future commit is a prune that does not exist.

### `xid` keys (deterministic, idempotent)

| Node | `xid` |
|---|---|
| `Repo` | `org/name` |
| `Failure` | `repo\|failure:<station run id>` (one per ATTEMPT, so a revisit is its own node) |
| `Overlay` | `repo\|run:<assembly run id>` (also the `.repo` scalar every node it anchors carries) |
| `Feature` | `repo\|specs/<folder>` |
| `Spec` | `repo\|file_path` |
| `File` | `repo\|file_path` (coverage-source aggregation; `Coverage.covers\|ranges` facet holds intervals) |
| `Block` | `repo\|file_path\|block\|ordinal` |
| `Section` | `repo\|file_path\|section_ordinal` |
| `Statement` | `repo\|file_path\|ordinal` |
| `AcceptanceCriterion` | `repo\|file_path\|ac\|ordinal` |
| `ADR` | `repo\|adr_number` |
| `CodeChunk` / `TestChunk` | Postgres chunk UUID (fallback `repo\|file_path\|symbol_name`) |
| `TestSuite` | `repo\|file_path\|suite_chain` (`>`-joined describe names, outermost→innermost) |
| `Coverage` | `repo\|test_file\|test_name` |

## Evidence tiers on `IMPLEMENTED_BY` / `VALIDATED_BY`

Edges carry an `evidence` property (modelled via a small reified
`TraceLink` node when the tier + provenance must be queryable; or as a
facet when only display is needed — reify if you need to query "all
execution-verified links"). Ordered, highest trust first:

| Tier | Established by | Trust |
|---|---|---|
| `execution-verified` | the coverage chain `Statement → Test → Coverage → Code` | proof |
| `generated-provenance` | declared at generation time (inline link / annotation / trailer), coverage-verified when available | proof-of-intent |
| `human-linked` | author's inline markdown link | assertion |
| `coverage-bridged` | sentence names a symbol the covered code defines (deterministic) | strong |
| `llm-suggested` | LLM judge over a vector+coverage-narrowed shortlist; **unconfirmed until a human ratifies** | weak |

Inverse signal: `link-unproven` — a `VALIDATED_BY` test whose `Coverage`
overlaps no `CodeChunk` relevant to the statement.

A statement's (or `AcceptanceCriterion`'s) status is a graph fact, not a
guess: `verified-implemented` iff an
`execution-verified`/`generated-provenance` edge exists; `claimed` iff
only `human-linked`; `untested` iff neither. An `untested`
`AcceptanceCriterion` is the highest-signal gap the graph can surface — a
contract clause with no test behind it.

## Projection (per changed spec file, zero-LLM)

`projectSpecFile(repo, file_path, content, dgraph)`:

0. Upsert the `Repo` root by `xid = org/name` and attach the `Spec` via
   `Repo.specs` — every node below threads back to this root. Gate the whole
   unit on `Spec.content_hash` (no-op if unchanged).
1. **Lossless source layer (the reconstruction substrate).**
   `segmentBlocks(content)` partitions the markdown into an ordered, verbatim
   block stream (`heading|paragraph|list-item|code|table|blank`) and upserts
   one `Block` per block — `xid = repo|file_path|block|ordinal`, verbatim
   `Block.text`, `Block.kind`, document-global `Block.ordinal`, `Block.level`
   for headings, and `Block.file_path` (the reconstruction key) — attached via
   `Spec.blocks`. The shared `projectDocumentBlocks` writer does this for both
   specs and ADRs. Orphaned blocks from a prior (longer) projection are pruned
   by `pruneOrphanBlocksByFile` (the `file_path`+`repo` index sweep, used by
   both document types). This layer is **byte-lossless by construction**: it
   keeps paragraphs whole (never sentence-split) and captures every line —
   including code fences, tables, and blank lines — so `reassembleBlocks`
   reproduces the source exactly. It is what `recomputeFile` reads.
2. **Testable semantic overlay.** `segmentStatements(content)` → upsert
   `Spec`/`Section`/`Statement` by `xid`; set `Statement.text_hash` and
   **verbatim** `text`; record `Section.level` (heading depth) and
   document-global `ordinal`s. This layer is lossy (sentence-split, drops
   code/tables) by design — it exists for spec→test traceability, NOT
   reconstruction (the Block layer owns that). The **Acceptance Criteria**
   heading is special-cased: its numbered list items are projected as
   `AcceptanceCriterion` nodes hung directly off the `Spec`
   (`Spec.acceptance_criteria`) — not as a `Section` of `Statement`s — so
   the testable contract is first-class and traced on its own edges. Each
   carries `ordinal` (document-global position), optional `label`, `text`,
   `text_hash`, and an `embedding`.
3. For each **statement and each `AcceptanceCriterion`**,
   `parseTestLinksInStatement()` → for each test link `resolveTestLink()`
   against chunks → upsert `TestChunk` (with `test_name`/`link_label` +
   `content_hash`) + `VALIDATED_BY` (from the `Statement` or the
   `AcceptanceCriterion`). The link grammar and resolver are identical for
   both node types — ACs carry the same inline `([validated by …](path))`
   parentheticals; only the source node differs.
4. Code links (non-test paths) → `IMPLEMENTED_BY` (`evidence=human-linked`
   or `generated-provenance`), again from either a `Statement` or an
   `AcceptanceCriterion`.
5. Generation provenance (`provenance.ts`): parse the inline link, the
   `// lore:validates` annotation, and the `Lore-Validates:` trailer; the
   most specific wins; discrepancies logged.
6. ADR links (paths under `adrs/`, or `per ADR-NNN` references) →
   `DECIDED_BY` from the `Statement`/`AcceptanceCriterion` to the `ADR`
   node (upserted by `repo|adr_number`). `projectAdrFile()` is the sibling
   unit that projects the ADR itself (number, title, status, `supersedes`)
   and attaches it via `Repo.adrs`.

`TestSuite` nodes are **not** built here — they're seeded by the
test-ingestion path ([`project-test-interface`](../project-test-interface/spec.md)).
When a test descriptor carries its `suite` chain, that unit upserts one
`TestSuite` per chain element by `xid = repo|file_path|suite_chain`, sets
`TestSuite.parent` to the enclosing element (file-level root has none),
links the `TestChunk` to the innermost via `TestChunk.suite`, and — when a
suite declares a spec anchor — sets `TestSuite.spec` (`VALIDATES_SPEC`).
Upserts are idempotent, so the same suite shared by many tests is created
once.

### Recompute (graph → markdown, the reverse unit)

`recomputeFile(repo, file_path, dgraph)` reconstructs any projected document
from the graph — the inverse of the Block projection, and **document-agnostic**:

1. Load the document's `Block`s by `eq(Block.file_path, file_path)` filtered
   on `Block.repo` (the `file_path`+`repo` index — works for any document,
   no parent-node dependency).
2. Sort by `Block.ordinal` (Dgraph does not guarantee child order) and
   `reassembleBlocks` them — rejoin the verbatim `Block.text`s with `"\n"`,
   the exact inverse of the line-partition `segmentBlocks` performed.

`recomputeSpecFile(repo, file_path, dgraph)` is a thin alias of `recomputeFile`
(specs and ADRs reconstruct through the same reader).

**Round-trip invariant — byte-exact:** `recomputeFile(...) === content` and
therefore `sha256(recompute) === content_hash`. Because the Block layer stores
every line verbatim (paragraphs whole, code fences and tables and blank lines
intact) and `reassembleBlocks`/`segmentBlocks` are true inverses of
`split("\n")`/`join("\n")`, reconstruction is **lossless to the byte**, not
merely canonical-equivalent. Divergence is a lossiness bug, caught by a test,
not discovered in production.

> The semantic layer (`Section`/`Statement`/`AcceptanceCriterion`) is **not**
> used for reconstruction — it is lossy by design (sentence-split, drops
> code/tables/headings-as-structure). Recompute reads only the Block layer.
> **ADRs** are now reconstructable the same way: `projectAdrFile` projects an
> ADR's Block layer (keyed by `Block.file_path`, pruned on re-projection by
> `pruneOrphanBlocksByFile`) and `recomputeFile` reconstructs it byte-exact —
> the ADR **metadata** node (`number`/`title`/`status`) is a separate, optional
> overlay for `DECIDED_BY`/`SUPERSEDES`, not needed for reconstruction.
> **Memories** are not multi-block markdown documents: `Memory.value` and
> `Episode` content are already stored verbatim, so they reconstruct directly
> (read the value) without a Block layer.

### Test-name resolution (best-effort, language-pluggable)

`TestChunk.test_name` fallback chain (all zero-LLM):

1. markdown link **label** (universal);
2. AST chunk `symbol_name` (where a grammar exists);
3. language pattern over the linked line range — `it/test/describe` (JS),
   `def test_` (Python), `func Test` (Go), `#[test] fn` (Rust),
   `@Test`/`*Test` (JUnit), `[Test]`/`[Fact]` (.NET), RSpec `it`, …

## Coverage ingestion (per report, zero-LLM)

`ingestCoverageReport(repo, tool, report, dgraph)` — realizes
`coverage-ingestion`:

- parse LCOV / Cobertura / go-cover deterministically;
- per test, upsert one `Coverage` node (`xid = repo|test_file|test_name`)
  + `HAS_COVERAGE` from its `TestChunk`;
- map each covered `(file, line-range)` to a `CodeChunk` by line overlap →
  `COVERS` edges; unmatched lines dropped with a logged count;
- gate on `Coverage.commit` (re-posting the same commit is a no-op).

## Drift query (per changed code/test file, zero-LLM)

`driftCheckFile(repo, file_path, newChunks, dgraph)`:

```dql
# reverse-traverse from a changed CodeChunk to affected statements,
# directly (IMPLEMENTED_BY) and via the coverage chain.
query affected($file: string, $hash: string) {
  changed as var(func: eq(CodeChunk.file_path, $file)) @filter(NOT eq(CodeChunk.content_hash, $hash))

  direct(func: uid(changed)) {
    ~Statement.implemented_by { uid Statement.xid Statement.text }
    ~AcceptanceCriterion.implemented_by { uid AcceptanceCriterion.xid AcceptanceCriterion.text }
  }

  viaCoverage(func: uid(changed)) {
    ~Coverage.covers {              # Coverage that covers this code
      ~TestChunk.coverage {         # the Test that has that coverage
        ~Statement.validated_by { uid Statement.xid Statement.text }
        ~AcceptanceCriterion.validated_by { uid AcceptanceCriterion.xid AcceptanceCriterion.text }
      }
    }
  }
}
```

For each affected statement: set `drifted=true`,
`drift_reason="code-content-changed (<symbol_name>)"`, update the chunk's
stored `content_hash`, and mark the `Coverage` stale. Link rot
(`file-missing` / `line-out-of-range`) is folded into the same pass with a
distinct `drift_reason`. Graded severity: compare the changed chunk's new
embedding to the statement embedding (cosine) — large distance ⇒
higher-severity drift.

## Vectors (candidate suggestion + graded drift)

- `CodeChunk`/`TestChunk` mirror the embeddings already on `{team}.chunks`
  (free); each `Statement` is embedded once at projection (testable
  statements only, to bound cost).
- **Candidate suggestion** for an un-linked statement:
  `similar_to(CodeChunk.embedding / TestChunk.embedding, k, $stmtVec)` —
  deterministic ANN, replacing the LLM judge as the default candidate
  generator (LLM only confirms the shortlist, off the default path).

## Relationship to existing tables / specs

- **`{team}.chunks`** (Postgres) is the source of `CodeChunk`/`TestChunk`
  (joined by chunk UUID) and the `content_hash` lives in its `metadata`
  JSONB (no DDL). Specs are `content_type='spec'` chunks.
- **Reuses** `segmentStatements` (moved to `shared/`), `spec-link-parser`,
  `resolveTestLink`, `isTestFile`, and `commit-trailers`.
- **Supersedes** the deferred relational `coverage_lines`/`coverage_runs`
  tables from `coverage-ingestion` — the graph holds `Coverage`/`COVERS`
  instead (the ingestion endpoint + parsers carry over).
- The graph lives in the **same Dgraph cluster** as the memory graph; no
  Postgres linker tables are reintroduced (per v3 / migration 0008).
