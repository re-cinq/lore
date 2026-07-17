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

### `xid` keys (deterministic, idempotent)

| Node | `xid` |
|---|---|
| `Repo` | `org/name` |
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
