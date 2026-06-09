# Feature Specification: Spec Traceability Graph

| Field          | Value                                              |
|----------------|----------------------------------------------------|
| Feature        | Spec Traceability Graph                            |
| Status         | **Draft**                                          |
| Created        | 2026-06-05                                         |
| Owner          | Platform Engineering                               |
| Depends on     | [`memory-dgraph-migration`](../memory-dgraph-migration/spec.md) (shared Dgraph cluster, client, ACL, deploy, vectors); **[`project-test-interface`](../project-test-interface/spec.md)** — built **first**; supplies test discovery, coverage, and the pass/fail (`violated`) signal the graph consumes |
| Builds on      | [`spec-test-coverage` v3](../spec-test-coverage/spec.md), [ADR-008 AST chunking](../../adrs/ADR-008-ast-chunking-via-tree-sitter.md) |
| Sequencing     | `project-test-interface` ships before this graph; this spec **references** it for test/coverage inputs rather than re-describing them |

## Problem Statement

There is no queryable, bidirectional, sentence-level map from a spec to
the tests and code that implement it. Drift detection today
([`spec-coverage-validate`](../../agent/src/jobs/scheduled/spec-coverage-validate.ts))
only catches **link rot** — a test link whose file was deleted or whose
line moved out of range. It cannot catch the case that matters most:

> The test still sits at line 42, but the implementation it covers
> changed. The spec sentence it validates may no longer be true — and
> nothing flags it.

We want to ask, cheaply and in both directions:

- "Which test and which code implement *this sentence*?"
- "This code/test just changed — *which spec sentences* might have
  drifted?"

And we want it to work for **any programming language**, and to lean on
the fact that Lore's code and tests are predominantly **Claude-generated
from the spec** (so the link is knowable at creation time, not only by
later inference).

## Solution

A **derived graph projection** in the shared Dgraph cluster. Markdown in
`spec.md` stays the source of truth (per v3, which dropped the relational
linker tables in migration 0008); the graph is a rebuilt-on-ingest index
optimized for traversal and drift queries.

The graph decomposes specs into sentence-level `Statement` nodes in a
`Statement → Section → Spec` hierarchy and links them:

```
Statement —VALIDATED_BY→ TestChunk —HAS_COVERAGE→ Coverage —COVERS→ CodeChunk
Statement —IMPLEMENTED_BY→ CodeChunk            (direct, or transitively via coverage)
Statement —IN_SECTION→ Section —IN_SPEC→ Spec
AcceptanceCriterion —IN_SPEC→ Spec   (parallel to Section; traced like a Statement)
Statement | AcceptanceCriterion —DECIDED_BY→ ADR    (the "why")
TestChunk —IN_SUITE→ TestSuite —PARENT_SUITE→ TestSuite …   (nested describe blocks)
TestSuite —VALIDATES_SPEC→ Spec                     (a whole suite declared against a spec)
Repo —IN_REPO→ {Spec, ADR, CodeChunk, TestChunk, TestSuite, Coverage}   (root of everything)
```

Three properties make it reliable and cheap:

1. **Links are captured at generation time** (primary), not inferred
   post-hoc. The Claude task that writes a test/function declares which
   statement it satisfies — three deterministic-to-parse ways. An LLM
   judge is only a legacy-tail fallback.
2. **Coverage is proof.** Execution coverage (LCOV/Cobertura/go-cover)
   supplies `COVERS` edges by line-range overlap, *verifying* declared
   links and giving the strongest evidence tier.
3. **Built by small, per-changed-file, zero-LLM background units** that
   also run locally — segmentation, link parsing, line-range resolution,
   and `sha256` are all deterministic.

Drift = a linked/covered chunk's `content_hash` changes → reverse-
traverse to the connected `Statement`s → flag `drifted`. Surfaced via the
existing issue machinery (`spec-link-rot` → add `spec-drift`) and spec-
detail UI badges.

### Design decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Source of truth | **Markdown stays canonical; graph is a derived projection** rebuilt on ingest | Reconciles with v3 / migration 0008; the graph never becomes a second truth to drift |
| Language-agnostic | **Universal substrate = file + line-range + content-hash**; coverage (LCOV/Cobertura) supplies `COVERS` regardless of language | No feature path needs a specific language; AST symbols + test-name patterns are optional enrichment |
| Build cost | **Zero-LLM build path** (tree-sitter + regex + line-range + sha256); per-changed-file incremental units | LLM only in the separate opt-in suggestion fallback; cheap, local, deterministic |
| Linking — primary | **Capture provenance at generation time**: inline spec link + `// lore:validates` annotation + `Lore-Validates:` commit trailer | The generating model already knows intent; reverse-inferring it later wastes that and pays twice |
| Linking — verification | **Coverage-first**: coverage verifies declared links and proposes candidates before any vector/heuristic/LLM step | Execution trace beats name/embedding guessing |
| Linking — fallback | **LLM judge, suggest-not-decide, legacy tail only**; shortlist narrowed by vectors+coverage; human ratifies | LLM is the exception handler, not the mechanism |
| Confidence tiers | `generated-provenance` (declared + coverage-verified) ≈ `human-linked` > `coverage-bridged` > `llm-suggested` | Trust is a graph fact, not a guess |
| Drift definition | **content-hash change of a linked/covered chunk** + link rot; plus **`violated`** (a validating test currently fails) from [`project-test-interface`](../project-test-interface/spec.md) | Catches silent behaviour drift and broken-claim, not just dead links |
| Test & coverage inputs | **Defined by [`project-test-interface`](../project-test-interface/spec.md)** (manifest, `tests.list`/`tests.run`, coverage endpoints, MCP tools) — this graph only **consumes** its output | Built first; the graph stays focused on nodes/edges/drift, not on running tests |
| Per-chunk hash | **`sha256(content)` in `chunks.metadata` JSONB** (no DDL) | The drift substrate, computed at ingest |
| Vectors | Mirror chunk embeddings to `CodeChunk`/`TestChunk`; embed each `Statement` once; `similar_to` for candidate suggestion + graded drift | Replaces the LLM judge with a deterministic pre-filter; cosine grades drift severity |

## User Experience

### Author / generated flow (no extra step)

When the implementation/feature task generates a test, the same PR adds
the inline link to the spec statement, the annotation to the test, and
the trailer to the commit. On ingest the graph builds itself; the spec-
detail page shows the statement **green + execution-verified**.

```
Statement in spec.md after a generated implementation PR:

  - claims a pending task before GKE picks it up.
    ([validated by `claimNextTask`](mcp-server/src/local-runner.test.ts#L88))

  → graph: Statement#14 —VALIDATED_BY→ TestChunk(local-runner.test.ts::"claims pending task")
                        —HAS_COVERAGE→ Coverage —COVERS→ CodeChunk(local-runner.ts::claimNextTask)
  → UI badge: ✅ execution-verified
```

### Drift flow (the payoff)

```
$ # someone edits the implementation, not the test
$ git commit -m "refactor claim query"      # local-runner.ts changes, content_hash differs

→ ingest → drift unit reverse-traverses COVERS/VALIDATED_BY
→ Statement#14.drifted = true, reason = "code-content-changed (claimNextTask)"
→ spec-drift issue opened + UI badge flips to ⚠ drifted
→ (optional) tests.run "claims pending task" re-runs just that test to refresh Coverage
```

### Local, zero-LLM

```
$ npm run trace:project        # rebuild the graph for changed specs in the working tree
$ npm run trace:ingest-coverage coverage/lcov.info
$ npm run trace:drift          # report statements whose linked/covered code changed
```

## Architecture

```
┌─────────────  ingest (mcp-server /api/ingest, reindex cron)  ─────────────┐
│  chunkFile() → chunks + metadata.content_hash = sha256(chunk.content)      │
│  post-ingest trigger ─────────────────────────────────────────────┐       │
└────────────────────────────────────────────────────────────────────┼──────┘
                                                                       ▼
┌──────────  agent/src/jobs/scheduled/spec-trace.ts (dispatcher)  ──────────┐
│  reindex change set → fan out small background units (per changed file):  │
│    • changed spec.md   → projectSpecFile()   (segment → Statement nodes)  │
│    • changed code/test → driftCheckFile()    (hash compare → flag stmts)  │
│    • coverage report   → ingestCoverageReport() (COVERS edges)            │
│  generation provenance → parse inline link + // lore:validates + trailer  │
└───────────────────────────────────┬───────────────────────────────────────┘
                                     ▼  DQL (shared dgraph-client)
┌──────────────────────  Dgraph (lore-memory ns)  ──────────────────────────┐
│  Spec ◄IN_SPEC─ Section ◄IN_SECTION─ Statement ─VALIDATED_BY► TestChunk    │
│                                          │                       │HAS_COV  │
│                                  IMPLEMENTED_BY               Coverage     │
│                                          ▼                       │COVERS   │
│                                      CodeChunk ◄─────────────────┘         │
│  (+ Statement/CodeChunk/TestChunk.embedding float32vector for similar_to)  │
└────────────────────────────────────────────────────────────────────────────┘
```

The DQL schema, edge predicates, evidence-tier modelling, and drift query
live in [`data-model.md`](./data-model.md). The project test-command
interface (manifest, `tests.list`/`tests.run`, coverage endpoints) is
specified in [`project-test-interface`](../project-test-interface/spec.md),
which ships first. Phasing in [`plan.md`](./plan.md).

## API

### Test & coverage inputs — see `project-test-interface`

Test discovery, per-test coverage, the bulk coverage endpoint
(`POST /api/repos/:o/:r/coverage`), the `POST /test-report` ingest
endpoint, the `tests.list`/`tests.run` manifest, and the `list_tests` /
`run_test` MCP tools are **defined by
[`project-test-interface`](../project-test-interface/spec.md)** (shipped
first). This graph **consumes** that output: a posted report/coverage run
seeds `TestChunk`, upserts `Coverage` + `COVERS`, sets `VALIDATED_BY` when
a descriptor carries a `spec` anchor, and sets `violated` when a
validating test fails. This spec does not re-specify that interface.

### Generation-time provenance (no new endpoint — parsed at ingest)

Three deterministic capture points, any subset accepted:

```
1. Inline spec link (canonical, in the same PR that adds the test):
     Statement text. ([validated by `name`](path/to/test.ext#L42))

2. Code annotation on the generated symbol (language-neutral comment):
     // lore:validates specs/foo/spec.md#7
     # lore:validates specs/foo/spec.md#7      (Python/Ruby/shell)

3. Commit trailer (via shared/src/commit-trailers.ts):
     Lore-Validates: specs/foo/spec.md#7 -> mcp-server/src/x.test.ts::claims pending task
```

(The `spec` anchor can also arrive on a `tests.list` descriptor — see
[`project-test-interface`](../project-test-interface/spec.md).)

## Data Model

Full DQL schema in [`data-model.md`](./data-model.md). Node summary:

| Node | Key (`xid`) | Carries |
|---|---|---|
| `Repo` | `org/name` | root of every node; `name`, edges to specs/adrs/chunks/coverage |
| `Spec` | `repo\|file_path` | `content_hash` |
| `Section` | `repo\|spec\|heading` | `heading`, `ordinal` |
| `Statement` | `repo\|spec\|ordinal` | `text`, `text_hash`, `kind`, `testability`, `category`, `drifted`, `drift_reason`, `embedding` |
| `AcceptanceCriterion` | `repo\|spec\|ac\|ordinal` | `ordinal`, `label`, `text`, `text_hash`, `drifted`, `drift_reason`, `embedding` (child of `Spec`, not `Section`; traced like a `Statement`) |
| `CodeChunk` | Postgres chunk UUID | `file_path`, `symbol_name`, `symbol_type`, `start/end_line`, `content_hash`, `embedding` |
| `TestChunk` | Postgres chunk UUID | `file_path`, `test_name`, `symbol_name`, `link_label`, `start/end_line`, `content_hash`, `embedding`; `suite` → enclosing `TestSuite` |
| `TestSuite` | `repo\|file_path\|suite_chain` | `name`, `file_path`; `parent` → enclosing suite (nests); `spec` → a Spec it's declared against |
| `Coverage` | `repo\|test_file\|test_name` | `tool`, `commit`, `generated_at`, `line_count` |
| `ADR` | `repo\|adr_number` | `number`, `title`, `status`, `content_hash`, `embedding` |

Edges: `IN_REPO`, `IN_SPEC`, `IN_SECTION`, `VALIDATED_BY`, `IMPLEMENTED_BY`
(with an `evidence` tier), `DECIDED_BY`, `SUPERSEDES`, `IN_SUITE`,
`PARENT_SUITE`, `VALIDATES_SPEC`, `HAS_COVERAGE`, `COVERS`.

The graph is **reversible**: `recomputeSpecFile()` walks it back to a
`spec.md` that hashes to the projected `Spec.content_hash` (round-trip
invariant), so the projection is lossless by construction.

## File Changes

| File | Change |
|------|--------|
| `shared/src/spec-segment.ts` | Move from `web-ui/src/lib/` so agent + mcp-server + web-ui share `segmentStatements`/`classifyByHeuristic` |
| `shared/src/spec-blocks.ts` | NEW: `segmentBlocks`/`reassembleBlocks` — the **lossless** block layer (verbatim, whole-paragraph, captures code/tables/blanks) that backs source reconstruction |
| `shared/src/spec-link-parser.ts` | Reuse `parseTestLinksInStatement`; add a code-link parse (non-test paths) for `IMPLEMENTED_BY` |
| `shared/src/test-paths.ts` | Broaden `isTestFile` across languages (pytest `test_*.py`, JUnit `*Test.java`, Rust `#[test]`, RSpec `_spec.rb`, .NET, …) |
| `shared/src/chunker.ts` | Compute `metadata.content_hash = sha256(chunk.content)`; (optional) add tree-sitter grammars (Rust/Java/Kotlin/C#/Ruby/PHP/C/C++/Swift) |
| `shared/src/commit-trailers.ts` | Add `Lore-Validates:` to the trailer vocabulary (parse/format) |
| `mcp-server/src/ingest.ts`, `agent/src/jobs/cron/reindex.ts` | Persist `content_hash` at both ingest paths |
| _Test interface_ (`mcp-server/src/routes/coverage.ts`, `/test-report`, `test-command-runner.ts`, `list_tests`/`run_test` MCP tools, CI templates) | **Owned by [`project-test-interface`](../project-test-interface/spec.md)** (built first); this graph consumes its posted output |
| `shared/src/spec-trace/project-spec-file.ts` | NEW: per-spec projection unit (upsert Repo root → **lossless `Block` layer** via `segmentBlocks` + the Section/Statement/AcceptanceCriterion semantic overlay; parse links → VALIDATED_BY/IMPLEMENTED_BY/DECIDED_BY; prune orphans by reverse-edge sweep) |
| `shared/src/spec-trace/project-adr-file.ts` | NEW: per-ADR projection — projects the ADR's **lossless `Block` layer** (shared `projectDocumentBlocks`, keyed by `Block.file_path`, pruned by `pruneOrphanBlocksByFile`) so ADRs reconstruct byte-exact; the ADR metadata node (number/title/status/supersedes for DECIDED_BY/SUPERSEDES) is a later overlay |
| `shared/src/spec-trace/project-blocks.ts` | NEW: shared block writer/pruner — `projectDocumentBlocks` (spec + ADR) + `pruneOrphanBlocksByFile` (file_path-scoped) |
| `shared/src/spec-trace/recompute-spec-file.ts` | NEW: reverse unit (graph → source) — `recomputeFile(repo, file_path)` reads the `Block` layer by `(file_path, repo)`, ordered → `reassembleBlocks`; **document-agnostic & byte-exact** `recompute === content` for specs AND ADRs (`recomputeSpecFile` is a thin alias) |
| `shared/src/spec-trace/ingest-coverage.ts` | NEW: per-report unit (parse → Coverage + COVERS) |
| `shared/src/spec-trace/drift-check-file.ts` | NEW: per-changed-file unit (hash compare → reverse-traverse → flag) |
| `shared/src/spec-trace/provenance.ts` | NEW: parse inline link + `// lore:validates` annotation + `Lore-Validates:` trailer |
| `agent/src/jobs/scheduled/spec-trace.ts` | NEW: thin dispatcher fanning out units per changed file |
| `agent/src/health.ts` | Trigger `spec-trace` post-ingest (alongside `spec-coverage-validate`) |
| `scripts/trace/{project-file,ingest-coverage,drift}.ts` | NEW: local CLIs (`trace:project` / `trace:ingest-coverage` / `trace:drift`) |
| `agent/src/lib/escalation.ts` / issue machinery | Add `spec-drift` label alongside `spec-link-rot` |
| `web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.tsx` | Drift/evidence badges per statement (graph-sourced) |
| Generation prompt templates (`scripts/task-types.yaml` / supervisor) | Instruct the implementation/feature task to emit the three provenance forms |

## Acceptance Criteria

1. `segmentStatements`/`classifyByHeuristic` live in `shared/` and are imported unchanged by web-ui, agent, and mcp-server; existing segmentation tests stay green. ([validated by `segments prose into sentences`](shared/src/spec-segment.test.ts#L9), [validated by `each list item is one statement`](shared/src/spec-segment.test.ts#L20))
2. `chunker.ts` writes `metadata.content_hash = sha256(chunk.content)` at both ingest paths; identical content yields an identical hash; changed content yields a different one. ([validated by `stamps content_hash`](shared/src/chunker.test.ts#L6))
3. `projectSpecFile()` is a pure, idempotent, zero-LLM unit: given a spec, it upserts the lossless `Block` layer plus the `Spec`/`Section`/`Statement` semantic overlay (deterministic `xid`s), sets `Statement.text_hash`, prunes orphaned children on re-projection (reverse-edge sweep, including the stale `Spec.sections`/`Spec.acceptance_criteria` forward edges), replaces a surviving statement's `validated_by`/`implemented_by` edges rather than set-unioning them, deletes a chunk node a dropped link orphaned only when no other statement or coverage still owns it, and is a no-op when `Spec.content_hash` is unchanged. ([validated by `projects Statement nodes with verbatim text and text_hash`](shared/src/spec-trace/__tests__/project-spec-file.test.ts#L127), [validated by `no-op on an unchanged second projection`](shared/src/spec-trace/__tests__/project-spec-file.test.ts#L258), [validated by `prunes the orphaned Statement on re-projection`](shared/src/spec-trace/__tests__/project-spec-file.test.ts#L371), [validated by `prunes an orphaned Section and its Spec.sections edge`](shared/src/spec-trace/__tests__/project-spec-file.test.ts#L398), [validated by `prunes an orphaned AcceptanceCriterion and its Spec.acceptance_criteria edge`](shared/src/spec-trace/__tests__/project-spec-file.test.ts#L422), [validated by `replaces a surviving statement's validated_by link on re-projection`](shared/src/spec-trace/__tests__/project-spec-file.test.ts#L578), [validated by `deletes a TestChunk no surviving statement links`](shared/src/spec-trace/__tests__/project-spec-file.test.ts#L600), [validated by `keeps a TestChunk another statement still links`](shared/src/spec-trace/__tests__/project-spec-file.test.ts#L618))
4. Generation provenance is captured from all three forms — inline spec link, `// lore:validates` annotation, and `Lore-Validates:` commit trailer — by deterministic parsers, with zero LLM calls; conflicting forms resolve to the most specific and log the discrepancy. ([validated by `parses a lore:validates annotation`](shared/src/spec-trace/__tests__/provenance.test.ts#L18), [validated by `annotation wins over inline on conflict`](shared/src/spec-trace/__tests__/provenance.test.ts#L69), [validated by `logs both targets when sources disagree`](shared/src/spec-trace/__tests__/provenance.test.ts#L98))
5. `ingestCoverageReport()` parses LCOV and Cobertura (zero-LLM), upserts one `Coverage` node per test + `COVERS` edges by line-range overlap to `CodeChunk`s, drops unmatched lines with a logged count, and is idempotent on `commit`. ([validated by `adds a COVERS edge on line-range overlap`](shared/src/spec-trace/__tests__/ingest-coverage.test.ts#L114), [validated by `counts unmatched lines`](shared/src/spec-trace/__tests__/ingest-coverage.test.ts#L154), [validated by `a new commit replaces COVERS`](shared/src/spec-trace/__tests__/ingest-coverage.test.ts#L167))
6. `IMPLEMENTED_BY`/`VALIDATED_BY` edges carry an `evidence` tier; a statement reachable through the coverage chain reads `execution-verified`, an author/generated inline link with no coverage reads `claimed`/`generated-provenance`, and a linked test that covers nothing relevant is flagged `link-unproven`. ([validated by `tags validated_by execution-verified when coverage proves it`](shared/src/spec-trace/__tests__/trace-link.test.ts#L227), [validated by `claimed for a human-linked-only statement`](shared/src/spec-trace/__tests__/statement-status.test.ts#L118), [validated by `generated-provenance is not downgraded`](shared/src/spec-trace/__tests__/trace-link.test.ts#L303), [validated by `link-unproven when a test covers nothing relevant`](shared/src/spec-trace/__tests__/verify-coverage.test.ts#L172))
7. `driftCheckFile()` flags a `Statement` `drifted=true` with `drift_reason="code-content-changed"` when a linked **or covered** chunk's `content_hash` changes — including the case where the implementation changed but its test did not — and still catches link rot (`file-missing`/`line-out-of-range`). ([validated by `drifts on a code content_hash change`](shared/src/spec-trace/__tests__/drift-check-file.test.ts#L156), [validated by `drifts via the coverage chain when covered code changes`](shared/src/spec-trace/__tests__/drift-check-file.test.ts#L222), [validated by `file-missing link rot`](shared/src/spec-trace/__tests__/drift-check-file.test.ts#L558), [validated by `line-out-of-range link rot`](shared/src/spec-trace/__tests__/drift-check-file.test.ts#L661))
8. The whole build/drift path works for a language with **no** tree-sitter grammar: nodes degrade to file+line granularity, `test_name` falls back to the markdown link label, and coverage-based `COVERS` edges + drift still function. ([validated by `a Ruby-linked spec projects to file+line nodes, covers, and drifts`](shared/src/spec-trace/__tests__/language-agnostic-e2e.test.ts#L105), [validated by `drift_reason falls back to the file path when no symbol_name`](shared/src/spec-trace/__tests__/drift-check-file.test.ts#L714))
9. Test discovery, per-test coverage, the manifest, ingest endpoints, MCP tools, and closed-loop re-verification are provided by [`project-test-interface`](../project-test-interface/spec.md) (built first); this graph consumes its posted output to seed `TestChunk`/`Coverage`/`COVERS`/`VALIDATED_BY` and the `violated` signal. The graph requires no test-runner code of its own. ([validated by `seeds a TestChunk from a descriptor`](shared/src/spec-trace/__tests__/ingest-test-report.test.ts#L119), [validated by `sets validated_by from a spec anchor`](shared/src/spec-trace/__tests__/ingest-test-report.test.ts#L148), [validated by `sets violated on a failing test`](shared/src/spec-trace/__tests__/ingest-test-report.test.ts#L172), [validated by `COVERS from a covered range`](shared/src/spec-trace/__tests__/ingest-test-report.test.ts#L283))
10. Vectors: `CodeChunk`/`TestChunk` mirror chunk embeddings and each `Statement` is embedded once; `similar_to` returns candidate links for an un-linked statement deterministically (no LLM), and cosine distance grades drift severity. ([validated by `each Statement and AcceptanceCriterion is embedded at projection`](shared/src/spec-trace/__tests__/project-spec-file.test.ts#L162), [validated by `similar_to returns the nearest candidate`](shared/src/spec-trace/__tests__/suggest-links.test.ts#L89), [validated by `cosine distance sets drift_severity`](shared/src/spec-trace/__tests__/drift-check-file.test.ts#L606))
11. The graph is a derived projection only — no DB linker tables are reintroduced; deleting the entire graph and re-running the units from markdown + chunks + coverage reproduces it exactly. ([validated by `delete + re-run the units reproduces the subgraph exactly`](shared/src/spec-trace/__tests__/determinism.test.ts#L152))
12. Drift surfaces via a `spec-drift`-labelled issue (reusing the broken-links report shape) and a per-statement badge on the spec-detail page; `violated` (from `project-test-interface`) surfaces as `spec-violated`. ([validated by `formats the drift finding into the report`](shared/src/spec-trace/__tests__/format-drift-report.test.ts#L15), [validated by `adds the stmt-drifted badge class`](web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L56))
13. The source is reconstructable from the graph **losslessly**: `projectSpecFile` stores the document as an ordered, verbatim `Block` stream (`segmentBlocks`: heading/paragraph/list-item/code/table/blank, paragraphs kept whole, code fences and tables and blank lines captured), and `recomputeSpecFile` reads those blocks (ordered by `Block.ordinal`) and `reassembleBlocks` reproduces the original byte-for-byte — `recompute === content`, so `sha256(recompute) == Spec.content_hash`. Re-projecting shorter content prunes the orphaned blocks so the round-trip tracks the current source. **The same path is document-agnostic**: `projectAdrFile` + `recomputeFile` reconstruct an ADR byte-exact too (keyed by `Block.file_path`); memories need no Block layer (`Memory.value`/`Episode` content is already stored verbatim). ([validated by `round-trips a single-paragraph source verbatim`](shared/src/spec-blocks.test.ts#L5), [validated by `recomputes the exact source of a multi-kind document from its projected Blocks`](shared/src/spec-trace/__tests__/project-spec-file.test.ts#L538), [validated by `recomputes the exact ADR source after projecting it through the graph`](shared/src/spec-trace/__tests__/project-adr-file.test.ts#L69), [validated by `recomputes the shorter source after re-projecting a SHORTER ADR over a longer one`](shared/src/spec-trace/__tests__/project-adr-file.test.ts#L109), [validated by `returns projected true then false on an unchanged re-projection (content_hash gate)`](shared/src/spec-trace/__tests__/project-adr-file.test.ts#L96))

## Limitations & Open Questions

1. **Per-test coverage attribution is tooling-dependent** (LCOV `TN:` vs Go per-file aggregate). Owned + documented by [`project-test-interface`](../project-test-interface/spec.md); the graph just stores whatever granularity arrives.
2. **Symbol-level granularity needs a grammar.** Where tree-sitter has no grammar, nodes are file+line only and `symbol_name` is null — still fully functional, just coarser. Adding grammars is incremental.
3. **Monorepo path mapping.** Coverage paths must be normalized repo-relative to join `chunks.file_path`; the CI template / test-command manifest owns normalization.
4. **Generation provenance only covers generated code.** Human-written/legacy code falls to the coverage-bridged or LLM-suggested tiers; coverage shrinks the LLM shortlist.
5. **Test-command execution trust boundary** is owned by [`project-test-interface`](../project-test-interface/spec.md) (opt-in, sandboxed, never on the long-lived services); out of scope for the graph, which only ingests output.
6. **Statement embedding cost.** Embedding each statement adds Vertex calls at projection time (not LLM generation). Mitigation: reuse spec-chunk embeddings where statement granularity is unnecessary; embed only testable statements.
7. **Provenance drift.** If a generated link's `ordinal` no longer matches a statement after a spec edit, the projection skips it with a warning (same behaviour as the v3 backfill's `proposeLinkInsertions`).
