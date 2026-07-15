# Feature Specification: Spec Traceability Graph

| Field          | Value                                              |
|----------------|----------------------------------------------------|
| Feature        | Spec Traceability Graph                            |
| Status         | **Shipped**                                          |
| Created        | 2026-06-05                                         |
| Owner          | Platform Engineering                               |
| Depends on     | [`memory-dgraph-migration`](../memory-dgraph-migration/spec.md) (shared Dgraph cluster, client, ACL, deploy, vectors); **[`project-test-interface`](../project-test-interface/spec.md)** — built **first**; supplies test discovery, coverage, and the pass/fail (`violated`) signal the graph consumes |
| Builds on      | [`spec-test-coverage` v3](../spec-test-coverage/spec.md), [ADR-008 AST chunking](../../adrs/ADR-008-ast-chunking-via-tree-sitter.md) |
| Sequencing     | `project-test-interface` ships before this graph; this spec **references** it for test/coverage inputs rather than re-describing them |
| Hardened by    | [ADR-026](../../adrs/ADR-026-spec-drift-graph-primary-detection.md) — the weekly `spec_drift` cron consumes this graph's `violated`/`drifted` signal; dedup, bounded infra-retry, and actionable issue copy |

## Problem Statement

There is no queryable, bidirectional, sentence-level map from a spec to
the tests and code that implement it. Drift detection today
([`spec-coverage-validate`](../../apps/floor/src/application/jobs/scheduled/spec-coverage-validate.ts))
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
    ([validated by `claimNextTask`](apps/mcp-server/src/local-runner.test.ts#L88))

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
┌──────────────  CI kickoff (GitHub Actions, per repo — ADR-023)  ──────────┐
│  lore-ingest.yml  → per-kind matrix [specs, adrs]                          │
│                     POST /api/repos/:o/:r/ingest-graph  {kinds:[<kind>]}   │
│  lore-tests.yml   → POST /api/repos/:o/:r/{test-report,coverage}          │
│  (content embedding still POSTs /api/ingest → chunks + content_hash)       │
│  each endpoint fires triggerAgentSpecTrace ──────────────────────┐        │
└───────────────────────────────────────────────────────────────────┼───────┘
                                                                      ▼
┌──────  /api/trigger/spec-trace → dispatchSpecTrace (coordinator)  ─────────┐
│  by kind family — server-side, inside the cluster (Dgraph is internal):    │
│    • specs / adrs (repo-read) → runIngestGraph(projectSpecFile/AdrFile)    │
│    • test-report / coverage   → ingestSpecTrace (validated_by / COVERS)    │
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

### Drift detection job — the weekly consumer (ADR-026)

The projection sets the per-statement `violated`/`drifted` flags above; the
weekly `spec_drift` detection
([spec-drift.ts](../../apps/floor/src/jobs/spec-trace/spec-drift/spec-drift.ts),
run per repo as the `detect` node of the `spec-drift` assembly line, fanned out
by the `cron.spec_drift.tick` handler in
[fan-out.ts](../../apps/floor/src/jobs/detect/fan-out.ts) — ADR-019 amendment) is the
**consumer** that turns them into gap-fill tasks. It is the single detector of
record; [ADR-026](../../adrs/ADR-026-spec-drift-graph-primary-detection.md) records
the decision.

- **Graph-primary.** When a spec is projected, drift is decided from its
  `violated`/`drifted` statements — deterministic, statement-level
  ([decideGraphDrift](../../apps/floor/src/application/jobs/cron/spec-drift-rules.ts)).
  A spec whose statements all resolve is **not** drifted (the former
  symbol-membership heuristic flagged clean specs like `GET /healthz` as fully
  diverged because endpoints/fields/methods aren't top-level symbols).
- **Heuristic fallback** (spec not projected / no graph): only top-level symbol
  kinds are scored, gated on both a divergence ratio and an absolute miss floor.
- **Hardening.** Dedup keys on the stable `context_bundle.spec_path`; a `failed`
  task ages out on a short cooldown instead of suppressing drift forever; a
  per-run cap bounds the batch; transient infra failures
  (`BackoffLimitExceeded`/`CreateContainerConfigError`) re-queue a bounded number
  of times ([infra-failure.ts](../../apps/floor/src/application/jobs/infra-failure.ts),
  [loretask-watcher.ts](../../apps/floor/src/application/jobs/scheduled/loretask-watcher.ts))
  rather than filing a terminal `lore-failed` issue.
- **Actionable issue copy** ([issue-body.ts](../../apps/floor/src/application/task-processing/issue-body.ts)):
  the drifted statements verbatim, a static remediation guidance block
  ([drift-issue-guidance.ts](../../apps/floor/src/application/jobs/cron/drift-issue-guidance.ts)),
  `created by spec-drift`, and a `Lore-Task` trailer that links to the deployed
  task page.

## API

### Test & coverage inputs — see `project-test-interface`

Test discovery, per-test coverage, the bulk coverage endpoint
(`POST /api/repos/:o/:r/coverage`), the `POST /test-report` ingest
endpoint, the `tests.list`/`tests.run` manifest, and the `lore_list_tests` /
`lore_run_test` MCP tools are **defined by
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
| _Test interface_ (`mcp-server/src/routes/coverage.ts`, `/test-report`, `test-command-runner.ts`, `lore_list_tests`/`lore_run_test` MCP tools, CI templates) | **Owned by [`project-test-interface`](../project-test-interface/spec.md)** (built first); this graph consumes its posted output |
| `shared/src/spec-trace/project-spec-file.ts` | NEW: per-spec projection unit (upsert Repo root → **lossless `Block` layer** via `segmentBlocks` + the Section/Statement/AcceptanceCriterion semantic overlay; parse links → VALIDATED_BY/IMPLEMENTED_BY/DECIDED_BY; prune orphans by reverse-edge sweep) |
| `shared/src/spec-trace/project-adr-file.ts` | NEW: per-ADR projection — projects the ADR's **lossless `Block` layer** (shared `projectDocumentBlocks`, keyed by `Block.file_path`, pruned by `pruneOrphanBlocksByFile`) so ADRs reconstruct byte-exact; the ADR metadata node (number/title/status/supersedes for DECIDED_BY/SUPERSEDES) is a later overlay |
| `shared/src/spec-trace/project-blocks.ts` | NEW: shared block writer/pruner — `projectDocumentBlocks` (spec + ADR) + `pruneOrphanBlocksByFile` (file_path-scoped) |
| `shared/src/spec-trace/recompute-spec-file.ts` | NEW: reverse unit (graph → source) — `recomputeFile(repo, file_path)` reads the `Block` layer by `(file_path, repo)`, ordered → `reassembleBlocks`; **document-agnostic & byte-exact** `recompute === content` for specs AND ADRs (`recomputeSpecFile` is a thin alias) |
| `shared/src/spec-trace/ingest-coverage.ts` | NEW: per-report unit (parse → Coverage + COVERS) |
| `shared/src/spec-trace/drift-check-file.ts` | NEW: per-changed-file unit (hash compare → reverse-traverse → flag) |
| `shared/src/spec-trace/provenance.ts` | NEW: parse inline link + `// lore:validates` annotation + `Lore-Validates:` trailer |
| `agent/src/jobs/scheduled/spec-trace.ts` | NEW: thin dispatcher fanning out units per changed file |
| `apps/floor/src/delivery/health.ts` | Host `/api/trigger/spec-trace` → `dispatchSpecTrace` (specs/adrs read-and-project, test-report/coverage payload). Kickoff is **CI-driven** (ADR-023): `lore-ingest.yml`/`lore-tests.yml` POST the mcp-server endpoints, which fire the trigger — not a post-ingest fan-out |
| `scripts/trace/{project-file,ingest-coverage,drift}.ts` | NEW: local CLIs (`trace:project` / `trace:ingest-coverage` / `trace:drift`) |
| `agent/src/lib/escalation.ts` / issue machinery | Add `spec-drift` label alongside `spec-link-rot` |
| `web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.tsx` | Drift/evidence badges per statement (graph-sourced) |
| Generation prompt templates (`scripts/task-types.yaml` / supervisor) | Instruct the implementation/feature task to emit the three provenance forms |

## Acceptance Criteria

1. `segmentStatements`/`classifyByHeuristic` live in `shared/` and are imported unchanged by web-ui, agent, and mcp-server; existing segmentation tests stay green. ([validated by `segments prose into sentences`](libs/shared/src/spec-segment.test.ts#L9), [validated by `each list item is one statement`](libs/shared/src/spec-segment.test.ts#L24))
2. `chunker.ts` writes `metadata.content_hash = sha256(chunk.content)` at both ingest paths; identical content yields an identical hash; changed content yields a different one. ([validated by `stamps content_hash`](libs/shared/src/chunker.test.ts#L6))
3. `projectSpecFile()` is a pure, idempotent, zero-LLM unit: given a spec, it upserts the lossless `Block` layer plus the `Spec`/`Section`/`Statement` semantic overlay (deterministic `xid`s), sets `Statement.text_hash`, prunes orphaned children on re-projection (reverse-edge sweep, including the stale `Spec.sections`/`Spec.acceptance_criteria` forward edges), replaces a surviving statement's `validated_by`/`implemented_by` edges rather than set-unioning them, deletes a chunk node a dropped link orphaned only when no other statement or coverage still owns it, and is a no-op when `Spec.content_hash` is unchanged. ([validated by `projects Statement nodes with verbatim text and text_hash`](libs/shared/src/spec-trace/project-spec-file.test.ts#L244), [validated by `no-op on an unchanged second projection`](libs/shared/src/spec-trace/project-spec-file.test.ts#L444), [validated by `prunes the orphaned Statement on re-projection`](libs/shared/src/spec-trace/project-spec-file.test.ts#L627), [validated by `prunes an orphaned Section and its Spec.sections edge`](libs/shared/src/spec-trace/project-spec-file.test.ts#L657), [validated by `prunes an orphaned AcceptanceCriterion and its Spec.acceptance_criteria edge`](libs/shared/src/spec-trace/project-spec-file.test.ts#L692), [validated by `replaces a surviving statement's validated_by link on re-projection`](libs/shared/src/spec-trace/project-spec-file.test.ts#L886), [validated by `deletes a TestChunk no surviving statement links`](libs/shared/src/spec-trace/project-spec-file.test.ts#L913), [validated by `keeps a TestChunk another statement still links`](libs/shared/src/spec-trace/project-spec-file.test.ts#L933))
4. Generation provenance is captured from all three forms — inline spec link, `// lore:validates` annotation, and `Lore-Validates:` commit trailer — by deterministic parsers, with zero LLM calls; conflicting forms resolve to the most specific and log the discrepancy. ([validated by `parses a lore:validates annotation`](libs/shared/src/spec-trace/provenance.test.ts#L18), [validated by `annotation wins over inline on conflict`](libs/shared/src/spec-trace/provenance.test.ts#L71), [validated by `logs both targets when sources disagree`](libs/shared/src/spec-trace/provenance.test.ts#L100))
5. `ingestCoverageReport()` parses LCOV and Cobertura (zero-LLM), upserts one `Coverage` node per test + `COVERS` edges by line-range overlap to `CodeChunk`s, drops unmatched lines with a logged count, and is idempotent on `commit`. ([validated by `adds a COVERS edge on line-range overlap`](libs/shared/src/spec-trace/ingest-coverage.test.ts#L184), [validated by `a new commit replaces COVERS`](libs/shared/src/spec-trace/ingest-coverage.test.ts#L224))
6. `IMPLEMENTED_BY`/`VALIDATED_BY` edges carry an `evidence` tier; a statement reachable through the coverage chain reads `execution-verified`, an author/generated inline link with no coverage reads `claimed`/`generated-provenance`, and a linked test that covers nothing relevant is flagged `link-unproven`. ([validated by `tags validated_by execution-verified when coverage proves it`](libs/shared/src/spec-trace/trace-link.test.ts#L314), [validated by `claimed for a human-linked-only statement`](libs/shared/src/spec-trace/statement-status.test.ts#L142), [validated by `generated-provenance is not downgraded`](libs/shared/src/spec-trace/trace-link.test.ts#L406), [validated by `link-unproven when a test covers nothing relevant`](libs/shared/src/spec-trace/verify-coverage.test.ts#L211))
7. `driftCheckFile()` flags a `Statement` `drifted=true` with `drift_reason="code-content-changed"` when a linked (`implemented_by`) chunk's `content_hash` changes, and still catches link rot (`file-missing`/`line-out-of-range`). Coverage aggregates to `File` nodes — `Coverage.covers` no longer targets per-range `CodeChunk`s carrying a hash — so coverage-chain content drift is not derived; only hash-bearing `implemented_by` chunks drive it. ([validated by `drifts on a code content_hash change`](libs/shared/src/spec-trace/drift-check-file.test.ts#L189), [validated by `file-missing link rot`](libs/shared/src/spec-trace/drift-check-file.test.ts#L473), [validated by `line-out-of-range link rot`](libs/shared/src/spec-trace/drift-check-file.test.ts#L592))
8. The whole build/drift path works for a language with **no** tree-sitter grammar: nodes degrade to file+line granularity, `test_name` falls back to the markdown link label, and coverage-based `COVERS` edges + drift still function. ([validated by `a Ruby-linked spec projects to file+line nodes, covers, and drifts`](libs/shared/src/spec-trace/language-agnostic-e2e.test.ts#L140), [validated by `drift_reason falls back to the file path when no symbol_name`](libs/shared/src/spec-trace/drift-check-file.test.ts#L657))
9. Test discovery, per-test coverage, the manifest, ingest endpoints, MCP tools, and closed-loop re-verification are provided by [`project-test-interface`](../project-test-interface/spec.md) (built first); this graph consumes its posted output to seed `TestChunk`/`Coverage`/`COVERS`/`VALIDATED_BY` and the `violated` signal. The graph requires no test-runner code of its own. ([validated by `seeds a TestChunk from a descriptor`](libs/shared/src/spec-trace/ingest-test-report.test.ts#L285), [validated by `sets validated_by from a spec anchor`](libs/shared/src/spec-trace/ingest-test-report.test.ts#L323), [validated by `sets violated on a failing test`](libs/shared/src/spec-trace/ingest-test-report.test.ts#L358), [validated by `COVERS from a covered range`](libs/shared/src/spec-trace/ingest-test-report.test.ts#L559))
10. Vectors: `CodeChunk`/`TestChunk` mirror chunk embeddings and each `Statement` is embedded once; `similar_to` returns candidate links for an un-linked statement deterministically (no LLM), and cosine distance grades drift severity. ([validated by `each Statement and AcceptanceCriterion is embedded at projection`](libs/shared/src/spec-trace/project-spec-file.test.ts#L287), [validated by `similar_to returns the nearest candidate`](libs/shared/src/spec-trace/suggest-links.test.ts#L111), [validated by `cosine distance sets drift_severity`](libs/shared/src/spec-trace/drift-check-file.test.ts#L525))
11. The graph is a derived projection only — no DB linker tables are reintroduced; deleting the entire graph and re-running the units from markdown + chunks + coverage reproduces it exactly. ([validated by `delete + re-run the units reproduces the subgraph exactly`](libs/shared/src/spec-trace/determinism.test.ts#L193))
12. Drift surfaces via a `spec-drift`-labelled issue (reusing the broken-links report shape) and a per-statement badge on the spec-detail page; `violated` (from `project-test-interface`) surfaces as `spec-violated`. ([validated by `formats the drift finding into the report`](libs/shared/src/spec-trace/format-drift-report.test.ts#L15), [validated by `adds the stmt-drifted badge class`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L64))
13. The source is reconstructable from the graph **losslessly**: `projectSpecFile` stores the document as an ordered, verbatim `Block` stream (`segmentBlocks`: heading/paragraph/list-item/code/table/blank, paragraphs kept whole, code fences and tables and blank lines captured), and `recomputeSpecFile` reads those blocks (ordered by `Block.ordinal`) and `reassembleBlocks` reproduces the original byte-for-byte — `recompute === content`, so `sha256(recompute) == Spec.content_hash`. Re-projecting shorter content prunes the orphaned blocks so the round-trip tracks the current source. **The same path is document-agnostic**: `projectAdrFile` + `recomputeFile` reconstruct an ADR byte-exact too (keyed by `Block.file_path`); memories need no Block layer (`Memory.value`/`Episode` content is already stored verbatim). ([validated by `round-trips a single-paragraph source verbatim`](libs/shared/src/spec-blocks.test.ts#L5), [validated by `recomputes the exact source of a multi-kind document from its projected Blocks`](libs/shared/src/spec-trace/project-spec-file.test.ts#L842), [validated by `recomputes the exact ADR source after projecting it through the graph`](libs/shared/src/spec-trace/project-adr-file.test.ts#L95), [validated by `recomputes the shorter source after re-projecting a SHORTER ADR over a longer one`](libs/shared/src/spec-trace/project-adr-file.test.ts#L162), [validated by `returns projected true then false on an unchanged re-projection (content_hash gate)`](libs/shared/src/spec-trace/project-adr-file.test.ts#L148))

### Drift detection job (ADR-026)

14. The `spec_drift` cron decides drift graph-first: a spec whose statements all resolve is reported clean (the `GET /healthz` case), and a statement that is `violated` or `drifted` is flagged with its section and reason; a spec with no projected statements reports no graph data so the caller falls back to the heuristic. ([validated by `is clean when every statement is satisfied`](libs/shared/src/detect/spec-drift-rules.test.ts#L138), [validated by `flags a violated statement with its section heading and reason`](libs/shared/src/detect/spec-drift-rules.test.ts#L150), [validated by `flags a drifted statement`](libs/shared/src/detect/spec-drift-rules.test.ts#L173), [validated by `reports no graph data when the document has no statements`](libs/shared/src/detect/spec-drift-rules.test.ts#L131))
15. The heuristic fallback only scores top-level symbol kinds and requires both a divergence ratio over threshold and an absolute floor of missing symbols; endpoints/fields are not scored. ([validated by `flags drift when at least 3 scorable symbols are missing past the threshold`](libs/shared/src/detect/spec-drift-rules.test.ts#L184), [validated by `does not flag drift when fewer than 3 symbols are missing`](libs/shared/src/detect/spec-drift-rules.test.ts#L193), [validated by `ignores endpoint and other kinds that are not top-level symbols`](libs/shared/src/detect/spec-drift-rules.test.ts#L205))
16. A `failed` drift task suppresses re-filing only within a short cooldown, then the spec resurfaces; an in-flight task suppresses a duplicate regardless of age. ([validated by `skips a recently failed task within the short failed cooldown`](libs/shared/src/detect/spec-drift-rules.test.ts#L99), [validated by `allows refiling once a failed task is past the short failed cooldown`](libs/shared/src/detect/spec-drift-rules.test.ts#L105), [validated by `skips when an open PR task already exists, regardless of age`](libs/shared/src/detect/spec-drift-rules.test.ts#L84))
17. Every drift issue carries the static remediation guidance for a drift task and omits it for a non-drift task. ([validated by `appends the guidance and a linkified footer for a drift task`](apps/floor/src/jobs/task/issue-body.test.ts#L30), [validated by `omits the guidance for a non-drift task but still writes the footer`](apps/floor/src/jobs/task/issue-body.test.ts#L45), [validated by `leads with the What you should actually do heading`](apps/floor/src/jobs/spec-trace/spec-drift/drift-issue-guidance.test.ts#L38))
18. The issue footer links the `Lore-Task` trailer to the deployed task page when a UI url is set and stays a bare uuid otherwise; graph-detected drifted statements (with their validated-by links) are listed verbatim, and heuristic runs list their missing symbols instead. ([validated by `links to the deployed task page when a UI url is set`](apps/floor/src/jobs/task/issue-body.test.ts#L5), [validated by `returns the bare uuid when no UI url is configured`](apps/floor/src/jobs/task/issue-body.test.ts#L17), [validated by `lists graph-detected drifted statements verbatim when present`](apps/floor/src/jobs/task/issue-body.test.ts#L56), [validated by `renders the validated-by link path for a graph-detected statement`](apps/floor/src/jobs/task/issue-body.test.ts#L71), [validated by `lists heuristic missing symbols when no graph statements rode in the bundle`](apps/floor/src/jobs/task/issue-body.test.ts#L96))
19. Transient infra failures (`BackoffLimitExceeded`, `CreateContainerConfigError`) are classified for bounded re-queue; a validation failure is not. ([validated by `classifies BackoffLimitExceeded as transient infra`](apps/floor/src/jobs/platform/infra-failure.test.ts#L5), [validated by `classifies CreateContainerConfigError as transient infra`](apps/floor/src/jobs/platform/infra-failure.test.ts#L13), [validated by `does not classify a validation failure as transient infra`](apps/floor/src/jobs/platform/infra-failure.test.ts#L17))

## Limitations & Open Questions

1. **Per-test coverage attribution is tooling-dependent** (LCOV `TN:` vs Go per-file aggregate). Owned + documented by [`project-test-interface`](../project-test-interface/spec.md); the graph just stores whatever granularity arrives.
2. **Symbol-level granularity needs a grammar.** Where tree-sitter has no grammar, nodes are file+line only and `symbol_name` is null — still fully functional, just coarser. Adding grammars is incremental.
3. **Monorepo path mapping.** Coverage paths must be normalized repo-relative to join `chunks.file_path`; the CI template / test-command manifest owns normalization.
4. **Generation provenance only covers generated code.** Human-written/legacy code falls to the coverage-bridged or LLM-suggested tiers; coverage shrinks the LLM shortlist.
5. **Test-command execution trust boundary** is owned by [`project-test-interface`](../project-test-interface/spec.md) (opt-in, sandboxed, never on the long-lived services); out of scope for the graph, which only ingests output.
6. **Statement embedding cost.** Embedding each statement adds Vertex calls at projection time (not LLM generation). Mitigation: reuse spec-chunk embeddings where statement granularity is unnecessary; embed only testable statements.
7. **Provenance drift.** If a generated link's `ordinal` no longer matches a statement after a spec edit, the projection skips it with a warning (same behaviour as the v3 backfill's `proposeLinkInsertions`).
