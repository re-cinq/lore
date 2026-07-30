# Feature Specification: Spec Traceability Graph

| Field          | Value                                              |
|----------------|----------------------------------------------------|
| Feature        | Spec Traceability Graph                            |
| Status         | In Progress                                          |
| Created        | 2026-06-05                                         |
| Owner          | Platform Engineering                               |
| Depends on     | [`memory-dgraph-migration`](../memory-dgraph-migration/spec.md) (shared Dgraph cluster, client, ACL, deploy, vectors); **[`project-test-interface`](../project-test-interface/spec.md)** — built **first**; supplies test discovery, coverage, and the pass/fail (`violated`) signal the graph consumes |
| Builds on      | [`spec-test-coverage` v3](../spec-test-coverage/spec.md), [ADR-008 AST chunking](../../adrs/ADR-008-ast-chunking-via-tree-sitter.md) |
| Sequencing     | `project-test-interface` ships before this graph; this spec **references** it for test/coverage inputs rather than re-describing them |
| Hardened by    | [ADR-026](../../adrs/ADR-026-spec-drift-graph-primary-detection.md) — the weekly `spec_drift` cron consumes this graph's `violated`/`drifted` signal; dedup, bounded infra-retry, and actionable issue copy |

The Spec Traceability Graph is a derived Dgraph projection giving a queryable, bidirectional, sentence-level map from spec statements to the tests and code that implement them, so drift detection can catch a statement whose implementation changed — not just link rot — across any programming language.

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

2. `chunker.ts` writes `metadata.content_hash = sha256(chunk.content)` at both ingest paths; identical content yields an identical hash; changed content yields a different one, and `buildIngestedChunkMetadata` carries that hash plus `file_path`/`ingested_by` (with `commit` on an api ingest, omitted for a reindex-job ingest). ([validated by `stamps content_hash`](libs/shared/src/chunker.test.ts#L6), [validated by `stamps content_hash equal to sha256 of the chunk's own content`](libs/shared/src/chunker.test.ts#L193), [validated by `carries content_hash, file_path, and ingested_by from an api ingest`](libs/shared/src/chunker.test.ts#L208), [validated by `omits commit when not provided for a reindex-job ingest`](libs/shared/src/chunker.test.ts#L225))

3. `projectSpecFile()` is a pure, idempotent, zero-LLM unit: given a spec, it upserts the lossless `Block` layer plus the `Spec`/`Section`/`Statement` semantic overlay (deterministic `xid`s), sets `Statement.text_hash`, prunes orphaned children on re-projection (reverse-edge sweep, including the stale `Spec.sections`/`Spec.acceptance_criteria` forward edges), replaces a surviving statement's `validated_by`/`implemented_by` edges rather than set-unioning them, deletes a chunk node a dropped link orphaned only when no other statement or coverage still owns it, and is a no-op when `Spec.content_hash` is unchanged. ([validated by `projects Statement nodes with verbatim text and text_hash`](libs/shared/src/spec-trace/project-spec-file.test.ts#L244), [validated by `no-op on an unchanged second projection`](libs/shared/src/spec-trace/project-spec-file.test.ts#L444), [validated by `prunes the orphaned Statement on re-projection`](libs/shared/src/spec-trace/project-spec-file.test.ts#L627), [validated by `prunes an orphaned Section and its Spec.sections edge`](libs/shared/src/spec-trace/project-spec-file.test.ts#L657), [validated by `prunes an orphaned AcceptanceCriterion and its Spec.acceptance_criteria edge`](libs/shared/src/spec-trace/project-spec-file.test.ts#L692), [validated by `replaces a surviving statement's validated_by link on re-projection`](libs/shared/src/spec-trace/project-spec-file.test.ts#L886), [validated by `deletes a TestChunk no surviving statement links`](libs/shared/src/spec-trace/project-spec-file.test.ts#L913), [validated by `keeps a TestChunk another statement still links`](libs/shared/src/spec-trace/project-spec-file.test.ts#L933), [validated by `project-spec-file:129`](libs/shared/src/spec-trace/project-spec-file.test.ts#L129), [validated by `project-spec-file:203`](libs/shared/src/spec-trace/project-spec-file.test.ts#L203), [validated by `project-spec-file:224`](libs/shared/src/spec-trace/project-spec-file.test.ts#L224), [validated by `project-spec-file:460`](libs/shared/src/spec-trace/project-spec-file.test.ts#L460), [validated by `project-spec-file:499`](libs/shared/src/spec-trace/project-spec-file.test.ts#L499), [validated by `project-spec-file:540`](libs/shared/src/spec-trace/project-spec-file.test.ts#L540), [validated by `project-spec-file:573`](libs/shared/src/spec-trace/project-spec-file.test.ts#L573), [validated by `project-spec-file:956`](libs/shared/src/spec-trace/project-spec-file.test.ts#L956))

4. Generation provenance is captured from all three forms — inline spec link, `// lore:validates` annotation, and `Lore-Validates:` commit trailer — by deterministic parsers, with zero LLM calls; conflicting forms resolve to the most specific and log the discrepancy. ([validated by `parses a lore:validates annotation`](libs/shared/src/spec-trace/provenance.test.ts#L18), [validated by `annotation wins over inline on conflict`](libs/shared/src/spec-trace/provenance.test.ts#L71), [validated by `logs both targets when sources disagree`](libs/shared/src/spec-trace/provenance.test.ts#L100), [validated by `provenance:33`](libs/shared/src/spec-trace/provenance.test.ts#L33), [validated by `provenance:59`](libs/shared/src/spec-trace/provenance.test.ts#L59), [validated by `provenance:128`](libs/shared/src/spec-trace/provenance.test.ts#L128))

5. `ingestCoverageReport()` parses LCOV and Cobertura (zero-LLM), upserts one `Coverage` node per test + `COVERS` edges by line-range overlap to `CodeChunk`s, drops unmatched lines with a logged count, and is idempotent on `commit`. ([validated by `adds a COVERS edge on line-range overlap`](libs/shared/src/spec-trace/ingest-coverage.test.ts#L184), [validated by `a new commit replaces COVERS`](libs/shared/src/spec-trace/ingest-coverage.test.ts#L224), [validated by `ingest-coverage:117`](libs/shared/src/spec-trace/ingest-coverage.test.ts#L117), [validated by `ingest-coverage:155`](libs/shared/src/spec-trace/ingest-coverage.test.ts#L155), [validated by `ingest-coverage:276`](libs/shared/src/spec-trace/ingest-coverage.test.ts#L276), [validated by `ingest-coverage:305`](libs/shared/src/spec-trace/ingest-coverage.test.ts#L305), [validated by `dgraph-upsert:103`](libs/shared/src/spec-trace/dgraph-upsert.test.ts#L103))

6. `IMPLEMENTED_BY`/`VALIDATED_BY` edges carry an `evidence` tier; a statement reachable through the coverage chain reads `execution-verified`, an author/generated inline link with no coverage reads `claimed`/`generated-provenance`, and a linked test that covers nothing relevant is flagged `link-unproven`. ([validated by `tags validated_by execution-verified when coverage proves it`](libs/shared/src/spec-trace/trace-link.test.ts#L314), [validated by `claimed for a human-linked-only statement`](libs/shared/src/spec-trace/statement-status.test.ts#L142), [validated by `generated-provenance is not downgraded`](libs/shared/src/spec-trace/trace-link.test.ts#L406), [validated by `link-unproven when a test covers nothing relevant`](libs/shared/src/spec-trace/verify-coverage.test.ts#L211), [validated by `verify-coverage:119`](libs/shared/src/spec-trace/verify-coverage.test.ts#L119), [validated by `verify-coverage:181`](libs/shared/src/spec-trace/verify-coverage.test.ts#L181), [validated by `statement-status:121`](libs/shared/src/spec-trace/statement-status.test.ts#L121), [validated by `statement-status:188`](libs/shared/src/spec-trace/statement-status.test.ts#L188), [validated by `trace-link:147`](libs/shared/src/spec-trace/trace-link.test.ts#L147), [validated by `trace-link:207`](libs/shared/src/spec-trace/trace-link.test.ts#L207), [validated by `trace-link:260`](libs/shared/src/spec-trace/trace-link.test.ts#L260), [validated by `trace-link-rank:5`](libs/shared/src/spec-trace/trace-link-rank.test.ts#L5))

7. `driftCheckFile()` flags a `Statement` `drifted=true` with `drift_reason="code-content-changed"` when a linked (`implemented_by`) chunk's `content_hash` changes, and still catches link rot (`file-missing`/`line-out-of-range`). Coverage aggregates to `File` nodes — `Coverage.covers` no longer targets per-range `CodeChunk`s carrying a hash — so coverage-chain content drift is not derived; only hash-bearing `implemented_by` chunks drive it. ([validated by `drifts on a code content_hash change`](libs/shared/src/spec-trace/drift-check-file.test.ts#L189), [validated by `file-missing link rot`](libs/shared/src/spec-trace/drift-check-file.test.ts#L473), [validated by `line-out-of-range link rot`](libs/shared/src/spec-trace/drift-check-file.test.ts#L592), [validated by `drift-check-file:265`](libs/shared/src/spec-trace/drift-check-file.test.ts#L265), [validated by `drift-check-file:327`](libs/shared/src/spec-trace/drift-check-file.test.ts#L327), [validated by `drift-check-file:399`](libs/shared/src/spec-trace/drift-check-file.test.ts#L399))

8. The whole build/drift path works for a language with **no** tree-sitter grammar: nodes degrade to file+line granularity, `test_name` falls back to the markdown link label, and coverage-based `COVERS` edges + drift still function. ([validated by `a Ruby-linked spec projects to file+line nodes, covers, and drifts`](libs/shared/src/spec-trace/language-agnostic-e2e.test.ts#L140), [validated by `drift_reason falls back to the file path when no symbol_name`](libs/shared/src/spec-trace/drift-check-file.test.ts#L657))

9. Test discovery, per-test coverage, the manifest, ingest endpoints, MCP tools, and closed-loop re-verification are provided by [`project-test-interface`](../project-test-interface/spec.md) (built first); this graph consumes its posted output to seed `TestChunk`/`Coverage`/`COVERS`/`VALIDATED_BY` and the `violated` signal. The graph requires no test-runner code of its own. ([validated by `seeds a TestChunk from a descriptor`](libs/shared/src/spec-trace/ingest-test-report.test.ts#L285), [validated by `sets validated_by from a spec anchor`](libs/shared/src/spec-trace/ingest-test-report.test.ts#L323), [validated by `sets violated on a failing test`](libs/shared/src/spec-trace/ingest-test-report.test.ts#L358), [validated by `COVERS from a covered range`](libs/shared/src/spec-trace/ingest-test-report.test.ts#L559), [validated by `end-to-end validated_by→coverage→covers`](libs/shared/src/spec-trace/ingest-test-report.test.ts#L504))

10. Vectors: `CodeChunk`/`TestChunk` mirror chunk embeddings and each `Statement` is embedded once; `similar_to` returns candidate links for an un-linked statement deterministically (no LLM), and cosine distance grades drift severity. ([validated by `each Statement and AcceptanceCriterion is embedded at projection`](libs/shared/src/spec-trace/project-spec-file.test.ts#L287), [validated by `similar_to returns the nearest candidate`](libs/shared/src/spec-trace/suggest-links.test.ts#L111), [validated by `cosine distance sets drift_severity`](libs/shared/src/spec-trace/drift-check-file.test.ts#L525), [validated by `suggest-links:148`](libs/shared/src/spec-trace/suggest-links.test.ts#L148), [validated by `suggest-links:185`](libs/shared/src/spec-trace/suggest-links.test.ts#L185), [validated by `suggest-links:230`](libs/shared/src/spec-trace/suggest-links.test.ts#L230))

11. The graph is a derived projection only — no DB linker tables are reintroduced; deleting the entire graph and re-running the units from markdown + chunks + coverage reproduces it exactly. ([validated by `delete + re-run the units reproduces the subgraph exactly`](libs/shared/src/spec-trace/determinism.test.ts#L193))

12. Drift surfaces via a `spec-drift`-labelled issue (reusing the broken-links report shape) and a per-statement badge on the spec-detail page; `violated` (from `project-test-interface`) surfaces as `spec-violated`. ([validated by `formats the drift finding into the report`](libs/shared/src/spec-trace/format-drift-report.test.ts#L15), [validated by `adds the stmt-drifted badge class`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx#L64), [validated by `format-drift-report:11`](libs/shared/src/spec-trace/format-drift-report.test.ts#L11))

13. The source is reconstructable from the graph **losslessly**: `projectSpecFile` stores the document as an ordered, verbatim `Block` stream (`segmentBlocks`: heading/paragraph/list-item/code/table/blank, paragraphs kept whole, code fences and tables and blank lines captured), and `recomputeSpecFile` reads those blocks (ordered by `Block.ordinal`) and `reassembleBlocks` reproduces the original byte-for-byte — `recompute === content`, so `sha256(recompute) == Spec.content_hash`. Re-projecting shorter content prunes the orphaned blocks so the round-trip tracks the current source. **The same path is document-agnostic**: `projectAdrFile` + `recomputeFile` reconstruct an ADR byte-exact too (keyed by `Block.file_path`); memories need no Block layer (`Memory.value`/`Episode` content is already stored verbatim). ([validated by `round-trips a single-paragraph source verbatim`](libs/shared/src/spec-blocks.test.ts#L5), [validated by `segments two blank-separated paragraphs into paragraph, blank, paragraph`](libs/shared/src/spec-blocks.test.ts#L14), [validated by `splits an ATX heading into a level-2 heading block before the following paragraph`](libs/shared/src/spec-blocks.test.ts#L25), [validated by `keeps a fenced code block with an internal blank and # line as one verbatim code block`](libs/shared/src/spec-blocks.test.ts#L39), [validated by `groups header, separator, and data rows into one table block`](libs/shared/src/spec-blocks.test.ts#L54), [validated by `splits two bullet lines into two separate list-item blocks`](libs/shared/src/spec-blocks.test.ts#L65), [validated by `recomputes the exact source of a multi-kind document from its projected Blocks`](libs/shared/src/spec-trace/project-spec-file.test.ts#L842), [validated by `recomputes the exact ADR source after projecting it through the graph`](libs/shared/src/spec-trace/project-adr-file.test.ts#L95), [validated by `recomputes the shorter source after re-projecting a SHORTER ADR over a longer one`](libs/shared/src/spec-trace/project-adr-file.test.ts#L162), [validated by `returns projected true then false on an unchanged re-projection (content_hash gate)`](libs/shared/src/spec-trace/project-adr-file.test.ts#L148), [validated by `project-spec-file:727`](libs/shared/src/spec-trace/project-spec-file.test.ts#L727), [validated by `project-spec-file:868`](libs/shared/src/spec-trace/project-spec-file.test.ts#L868), [validated by `project-adr-file:123`](libs/shared/src/spec-trace/project-adr-file.test.ts#L123), [validated by `recompute-spec-file:20`](libs/shared/src/spec-trace/recompute-spec-file.test.ts#L20), [validated by `recompute-spec-file:24`](libs/shared/src/spec-trace/recompute-spec-file.test.ts#L24), [validated by `recompute-spec-file:32`](libs/shared/src/spec-trace/recompute-spec-file.test.ts#L32), [validated by `recompute-spec-file:38`](libs/shared/src/spec-trace/recompute-spec-file.test.ts#L38), [validated by `recompute-spec-file:124`](libs/shared/src/spec-trace/recompute-spec-file.test.ts#L124))

### Drift detection job (ADR-026)

14. The `spec_drift` cron decides drift graph-first: a spec whose statements all resolve is reported clean (the `GET /healthz` case), and a statement that is `violated` or `drifted` is flagged with its section and reason; a spec with no projected statements reports no graph data so the caller falls back to the heuristic. ([validated by `is clean when every statement is satisfied`](libs/shared/src/detect/spec-drift-rules.test.ts#L138), [validated by `flags a violated statement with its section heading and reason`](libs/shared/src/detect/spec-drift-rules.test.ts#L150), [validated by `flags a drifted statement`](libs/shared/src/detect/spec-drift-rules.test.ts#L173), [validated by `reports no graph data when the document has no statements`](libs/shared/src/detect/spec-drift-rules.test.ts#L131))

15. The heuristic fallback only scores top-level symbol kinds and requires both a divergence ratio over threshold and an absolute floor of missing symbols; endpoints/fields are not scored. ([validated by `flags drift when at least 3 scorable symbols are missing past the threshold`](libs/shared/src/detect/spec-drift-rules.test.ts#L184), [validated by `does not flag drift when fewer than 3 symbols are missing`](libs/shared/src/detect/spec-drift-rules.test.ts#L193), [validated by `ignores endpoint and other kinds that are not top-level symbols`](libs/shared/src/detect/spec-drift-rules.test.ts#L205))

16. `shouldSkipDrift` gates re-filing: no existing task files one; an in-flight task — an open PR or one awaiting review — suppresses a duplicate regardless of age; a `failed` or `merged` task suppresses only within its cooldown, then the spec resurfaces; an old cancelled task never suppresses. ([validated by `creates a task when none exists`](libs/shared/src/detect/spec-drift-rules.test.ts#L80), [validated by `skips when an open PR task already exists, regardless of age`](libs/shared/src/detect/spec-drift-rules.test.ts#L84), [validated by `skips when a task is awaiting review`](libs/shared/src/detect/spec-drift-rules.test.ts#L93), [validated by `skips a recently failed task within the short failed cooldown`](libs/shared/src/detect/spec-drift-rules.test.ts#L99), [validated by `allows refiling once a failed task is past the short failed cooldown`](libs/shared/src/detect/spec-drift-rules.test.ts#L105), [validated by `skips a recently merged task within the cooldown`](libs/shared/src/detect/spec-drift-rules.test.ts#L111), [validated by `allows refiling once a merged task is past the cooldown`](libs/shared/src/detect/spec-drift-rules.test.ts#L117), [validated by `allows refiling after an old cancelled task`](libs/shared/src/detect/spec-drift-rules.test.ts#L123))

17. Every drift issue carries the static remediation guidance for a drift task and omits it for a non-drift task. ([validated by `appends the guidance and a linkified footer for a drift task`](apps/floor/src/jobs/task/issue-body.test.ts#L30), [validated by `omits the guidance for a non-drift task but still writes the footer`](apps/floor/src/jobs/task/issue-body.test.ts#L45), [validated by `leads with the What you should actually do heading`](apps/floor/src/jobs/spec-trace/spec-drift/drift-issue-guidance.test.ts#L38), [validated by `drift-issue-guidance:5`](apps/floor/src/jobs/spec-trace/spec-drift/drift-issue-guidance.test.ts#L5), [validated by `drift-issue-guidance:14`](apps/floor/src/jobs/spec-trace/spec-drift/drift-issue-guidance.test.ts#L14), [validated by `drift-issue-guidance:23`](apps/floor/src/jobs/spec-trace/spec-drift/drift-issue-guidance.test.ts#L23), [validated by `drift-issue-guidance:32`](apps/floor/src/jobs/spec-trace/spec-drift/drift-issue-guidance.test.ts#L32), [validated by `drift-issue-guidance:42`](apps/floor/src/jobs/spec-trace/spec-drift/drift-issue-guidance.test.ts#L42))

18. The issue footer links the `Lore-Task` trailer to the deployed task page when a UI url is set and stays a bare uuid otherwise; graph-detected drifted statements (with their validated-by links) are listed verbatim, and heuristic runs list their missing symbols instead. ([validated by `links to the deployed task page when a UI url is set`](apps/floor/src/jobs/task/issue-body.test.ts#L5), [validated by `returns the bare uuid when no UI url is configured`](apps/floor/src/jobs/task/issue-body.test.ts#L17), [validated by `lists graph-detected drifted statements verbatim when present`](apps/floor/src/jobs/task/issue-body.test.ts#L56), [validated by `renders the validated-by link path for a graph-detected statement`](apps/floor/src/jobs/task/issue-body.test.ts#L71), [validated by `lists heuristic missing symbols when no graph statements rode in the bundle`](apps/floor/src/jobs/task/issue-body.test.ts#L96))

19. Transient infra failures (`BackoffLimitExceeded`, `CreateContainerConfigError`) are classified for bounded re-queue; a validation failure is not. ([validated by `classifies BackoffLimitExceeded as transient infra`](apps/floor/src/jobs/platform/infra-failure.test.ts#L5), [validated by `classifies CreateContainerConfigError as transient infra`](apps/floor/src/jobs/platform/infra-failure.test.ts#L13), [validated by `does not classify a validation failure as transient infra`](apps/floor/src/jobs/platform/infra-failure.test.ts#L17))

### Projection, ingest & read units (additional)

20. `projectSpecFile` turns a statement's inline `([validated by](path#Lline))` into a `VALIDATED_BY` edge to a file-scoped `TestChunk` (two links to one file collapse to the runner's node), an inline code link into `IMPLEMENTED_BY` to a `CodeChunk`, and a cited ADR into `DECIDED_BY`; an `AcceptanceCriterion` gets the same `validated_by` treatment. A link's target path is resolved repo-relative (bare `./`/`../` resolved against the spec's directory, fragment stripped), dropping bare-anchor, empty, or repo-escaping targets. ([validated by `project-spec-file:335`](libs/shared/src/spec-trace/project-spec-file.test.ts#L335), [validated by `project-spec-file:376`](libs/shared/src/spec-trace/project-spec-file.test.ts#L376), [validated by `project-spec-file:406`](libs/shared/src/spec-trace/project-spec-file.test.ts#L406), [validated by `project-spec-file:1003`](libs/shared/src/spec-trace/project-spec-file.test.ts#L1003), [validated by `project-spec-file:1043`](libs/shared/src/spec-trace/project-spec-file.test.ts#L1043), [validated by `link-target-path:5`](libs/shared/src/spec-trace/link-target-path.test.ts#L5), [validated by `link-target-path:11`](libs/shared/src/spec-trace/link-target-path.test.ts#L11), [validated by `link-target-path:17`](libs/shared/src/spec-trace/link-target-path.test.ts#L17), [validated by `link-target-path:23`](libs/shared/src/spec-trace/link-target-path.test.ts#L23), [validated by `link-target-path:32`](libs/shared/src/spec-trace/link-target-path.test.ts#L32), [validated by `link-target-path:36`](libs/shared/src/spec-trace/link-target-path.test.ts#L36), [validated by `link-target-path:42`](libs/shared/src/spec-trace/link-target-path.test.ts#L42))

21. A feature folder's markdown files group under one `Feature` node via `Spec.feature`, keyed by the spec path's feature directory: `specs/<feature>` for a `spec.md` in that folder, the feature folder for a nested `contracts/` doc, `.specify` for a `.specify/spec.md`, and null for a repo-root file with no directory. ([validated by `project-spec-file:157`](libs/shared/src/spec-trace/project-spec-file.test.ts#L157), [validated by `feature-dir:11`](libs/shared/src/spec-trace/feature-dir.test.ts#L11), [validated by `feature-dir:17`](libs/shared/src/spec-trace/feature-dir.test.ts#L17), [validated by `feature-dir:23`](libs/shared/src/spec-trace/feature-dir.test.ts#L23), [validated by `feature-dir:27`](libs/shared/src/spec-trace/feature-dir.test.ts#L27))

22. Items under a canonical "Acceptance Criteria" heading (and its title-case variants) project as `AcceptanceCriterion` nodes off the `Spec`, not as `Statement`s; ordinary headings (and null) do not match. ([validated by `project-spec-file:770`](libs/shared/src/spec-trace/project-spec-file.test.ts#L770), [validated by `acceptance-criteria-heading:5`](libs/shared/src/spec-trace/acceptance-criteria-heading.test.ts#L5), [validated by `acceptance-criteria-heading:18`](libs/shared/src/spec-trace/acceptance-criteria-heading.test.ts#L18))

23. Sentence-match fallback (no descriptor anchor): a test name is normalized (lowercased, whitespace removed, trailing inline-link parenthetical stripped, ragged multi-line collapsed) and split into `spec | sentence | label`; a 3-level `describe > describe > it` chain resolves the spec title (substring match, case- and space-insensitive) plus the statement sentence (matched even inside a statement carrying an inline link) to the statement uid, setting `validated_by`; two-level unit chains, missing suites, fewer than three segments, and unrelated needles resolve to nothing. ([validated by `sentence-link:10`](libs/shared/src/spec-trace/sentence-link.test.ts#L10), [validated by `sentence-link:16`](libs/shared/src/spec-trace/sentence-link.test.ts#L16), [validated by `sentence-link:22`](libs/shared/src/spec-trace/sentence-link.test.ts#L22), [validated by `sentence-link:30`](libs/shared/src/spec-trace/sentence-link.test.ts#L30), [validated by `sentence-link:42`](libs/shared/src/spec-trace/sentence-link.test.ts#L42), [validated by `sentence-link:50`](libs/shared/src/spec-trace/sentence-link.test.ts#L50), [validated by `sentence-link:57`](libs/shared/src/spec-trace/sentence-link.test.ts#L57), [validated by `sentence-link:72`](libs/shared/src/spec-trace/sentence-link.test.ts#L72), [validated by `sentence-link:83`](libs/shared/src/spec-trace/sentence-link.test.ts#L83), [validated by `sentence-link:89`](libs/shared/src/spec-trace/sentence-link.test.ts#L89), [validated by `sentence-link:102`](libs/shared/src/spec-trace/sentence-link.test.ts#L102), [validated by `sentence-link:111`](libs/shared/src/spec-trace/sentence-link.test.ts#L111), [validated by `sentence-link:120`](libs/shared/src/spec-trace/sentence-link.test.ts#L120), [validated by `resolve-sentence-link:99`](libs/shared/src/spec-trace/resolve-sentence-link.test.ts#L99), [validated by `resolve-sentence-link:126`](libs/shared/src/spec-trace/resolve-sentence-link.test.ts#L126), [validated by `ingest-test-report:202`](libs/shared/src/spec-trace/ingest-test-report.test.ts#L202), [validated by `ingest-test-report:241`](libs/shared/src/spec-trace/ingest-test-report.test.ts#L241))

24. `dispatchSpecTrace` never projects inline (specs/ingest-station FR6 — every dgraph write happens in an ingest-station pod): docs kinds (`specs`/`adrs`) and payload kinds (`test-report`/`coverage`) each start one `ingest` assembly line, leased per `(kind, ref)` via the `ingest/<kind>/<ref>` branch key, with payload kinds handing their body off by reference through the scheduling event's id; a docs kind without the `startLine` dep, a payload kind without the `eventId`, and an unrecognized kind all enforce-throw without reading the repo or starting a line. A `force` run without a `glob` self-chunks into one child `internal.ingest.spec_trace` event per top-level directory (dedupe-keyed `spec-trace-force:<kind>:<ref>:<glob>`, via `chunkGlobsForKind` — the only repo read left in the Floor), because a whole-repo force pass re-embeds every statement and would blow the station deadline as one pod; chunks carry a glob and so never re-chunk. ([validated by `spec-trace-dispatch:35`](apps/floor/src/jobs/spec-trace/spec-trace-dispatch.test.ts#L35), [validated by `spec-trace-dispatch:86`](apps/floor/src/jobs/spec-trace/spec-trace-dispatch.test.ts#L86), [validated by `spec-trace-dispatch:100`](apps/floor/src/jobs/spec-trace/spec-trace-dispatch.test.ts#L100), [validated by `spec-trace-dispatch:148`](apps/floor/src/jobs/spec-trace/spec-trace-dispatch.test.ts#L148), [validated by `spec-trace-dispatch:191`](apps/floor/src/jobs/spec-trace/spec-trace-dispatch.test.ts#L191), [validated by `spec-trace-dispatch:205`](apps/floor/src/jobs/spec-trace/spec-trace-dispatch.test.ts#L205), [validated by `chunk-globs:65`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L65), [validated by `chunk-globs:83`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L83), [validated by `chunk-globs:87`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L87); implemented by [`spec-trace-dispatch.ts:71`](apps/floor/src/jobs/spec-trace/spec-trace-dispatch.ts#L71), [`internal.ts:32`](apps/floor/src/jobs/internal.ts#L32))

25. `runIngestGraph` selects `specs/` + `.specify/` markdown for the `specs` kind and only `adrs/` markdown for `adrs` (nothing for an unknown kind); manifest globs replace the prefix defaults when given; it routes each selected path to its projection unit, running siblings and recording a failure when one unit throws; it reports `completed` when everything projected or everything was an unchanged skip, `failed` only when every attempted file failed, stays `completed` on a partial failure, short-circuits to `skipped` when no dgraph client is configured, is idempotent (projects then skips identical content on a second run), and self-skips the `tests` kind when no `buildTestReport` port is provided. ([validated by `ingest-graph-task:32`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L32), [validated by `ingest-graph-task:40`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L40), [validated by `ingest-graph-task:44`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L44), [validated by `ingest-graph-task:48`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L48), [validated by `ingest-graph-task:93`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L93), [validated by `ingest-graph-task:102`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L102), [validated by `ingest-graph-task:109`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L109), [validated by `ingest-graph-task:115`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L115), [validated by `ingest-graph-task:175`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L175), [validated by `ingest-graph-task:185`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L185), [validated by `ingest-graph-task:366`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L366), [validated by `trace-units:10`](libs/shared/src/spec-trace/trace-units.test.ts#L10), [validated by `trace-units:16`](libs/shared/src/spec-trace/trace-units.test.ts#L16), [validated by `trace-units:22`](libs/shared/src/spec-trace/trace-units.test.ts#L22), [validated by `trace-units:26`](libs/shared/src/spec-trace/trace-units.test.ts#L26), [validated by `trace-units:32`](libs/shared/src/spec-trace/trace-units.test.ts#L32), [validated by `ingest-patterns:5`](libs/shared/src/spec-trace/ingest-patterns.test.ts#L5), [validated by `ingest-patterns:20`](libs/shared/src/spec-trace/ingest-patterns.test.ts#L20), [validated by `ingest-patterns:28`](libs/shared/src/spec-trace/ingest-patterns.test.ts#L28))

26. `classifyFile` labels ingest inputs by type: `CLAUDE.md` (nested too) as `doc`, `adrs/` as `adr`, `specs/`/`.specify/` markdown as `spec`, source as `code` — a source file under a nested `specs/` dir stays `code`, not `spec` — and skips binary and unknown file types (null). ([validated by `ingest:5`](apps/lore-api/src/features/spec-trace/ingest.test.ts#L5), [validated by `ingest:9`](apps/lore-api/src/features/spec-trace/ingest.test.ts#L9), [validated by `ingest:13`](apps/lore-api/src/features/spec-trace/ingest.test.ts#L13), [validated by `ingest:17`](apps/lore-api/src/features/spec-trace/ingest.test.ts#L17), [validated by `ingest:22`](apps/lore-api/src/features/spec-trace/ingest.test.ts#L22), [validated by `ingest:28`](apps/lore-api/src/features/spec-trace/ingest.test.ts#L28), [validated by `ingest:35`](apps/lore-api/src/features/spec-trace/ingest.test.ts#L35), [validated by `ingest:41`](apps/lore-api/src/features/spec-trace/ingest.test.ts#L41))

27. `assembleTraceDocument` (the `query_trace` / `GET /trace/document` read) orders statements by ordinal, derives each statement's state + the spec's coverage counts (counting a validated `AcceptanceCriterion` alongside a tested `Statement`), returns ordered sections with each statement's section ref, links, and drift/violation metadata, and derives the document title (spec H1 over the first section heading, falling back to the file basename when there are no sections) and description (the ordinal-first statement's text). The generic markdown summarizer takes the first heading as title and the first non-heading, non-blank line as description, skipping a leading YAML frontmatter block (an ADR yields its H1 title and lead paragraph) while leaving a later or unclosed `---` alone. ([validated by `assemble-trace-document:5`](libs/shared/src/spec-trace/assemble-trace-document.test.ts#L5), [validated by `assemble-trace-document:59`](libs/shared/src/spec-trace/assemble-trace-document.test.ts#L59), [validated by `assemble-trace-document:109`](libs/shared/src/spec-trace/assemble-trace-document.test.ts#L109), [validated by `assemble-trace-document:189`](libs/shared/src/spec-trace/assemble-trace-document.test.ts#L189), [validated by `assemble-trace-document:217`](libs/shared/src/spec-trace/assemble-trace-document.test.ts#L217), [validated by `assemble-trace-document:244`](libs/shared/src/spec-trace/assemble-trace-document.test.ts#L244), [validated by `assemble-trace-document:262`](libs/shared/src/spec-trace/assemble-trace-document.test.ts#L262), [validated by `summarize-markdown:5`](libs/shared/src/spec-trace/summarize-markdown.test.ts#L5), [validated by `summarize-markdown:11`](libs/shared/src/spec-trace/summarize-markdown.test.ts#L11), [validated by `summarize-markdown:20`](libs/shared/src/spec-trace/summarize-markdown.test.ts#L20), [validated by `summarize-markdown:30`](libs/shared/src/spec-trace/summarize-markdown.test.ts#L30), [validated by `summarize-markdown:36`](libs/shared/src/spec-trace/summarize-markdown.test.ts#L36))

28. The spec-graph view builder flattens specs + linked statements into labelled nodes with popover metadata, counts per-section coverage and tags each `validated_by` statement tested, links a `TestChunk` to the `File` its coverage covers (ranges facet as detail), de-duplicates a `File` covered by two `TestChunk`s and a `TestChunk` shared by two statements, groups specs under their shared `Feature` via `in_feature`, emits an `AcceptanceCriterion` node linked `in_spec` and to its `validated_by` `TestChunk`, derives a `<dir> (<doc>)` label (falling back to the doc name with no directory), and returns an empty graph/rings for empty input. Persistent (draft) features are merged into the computed graph without duplicating matched features and leave the graph unchanged when there are none. ([validated by `spec-graph:10`](libs/shared/src/spec-trace/spec-graph.test.ts#L10), [validated by `spec-graph:51`](libs/shared/src/spec-trace/spec-graph.test.ts#L51), [validated by `spec-graph:57`](libs/shared/src/spec-trace/spec-graph.test.ts#L57), [validated by `spec-graph:65`](libs/shared/src/spec-trace/spec-graph.test.ts#L65), [validated by `spec-graph:71`](libs/shared/src/spec-trace/spec-graph.test.ts#L71), [validated by `spec-graph:133`](libs/shared/src/spec-trace/spec-graph.test.ts#L133), [validated by `spec-graph:179`](libs/shared/src/spec-trace/spec-graph.test.ts#L179), [validated by `spec-graph:230`](libs/shared/src/spec-trace/spec-graph.test.ts#L230), [validated by `spec-graph:255`](libs/shared/src/spec-trace/spec-graph.test.ts#L255), [validated by `spec-graph:282`](libs/shared/src/spec-trace/spec-graph.test.ts#L282), [validated by `spec-graph:321`](libs/shared/src/spec-trace/spec-graph.test.ts#L321), [validated by `merge-persistent-features:61`](libs/shared/src/spec-trace/merge-persistent-features.test.ts#L61), [validated by `merge-persistent-features:75`](libs/shared/src/spec-trace/merge-persistent-features.test.ts#L75))

29. The agent-facing spec-trace context block degrades to an empty block when no dgraph client is given. ([validated by `graph-context:211`](libs/shared/src/spec-trace/graph-context.test.ts#L211))

30. Trace-impact pre-merge check (a diff-driven graph consumer): `computeImpact` reverse-traverses from a diff's changed/deleted ranges to surface coupled statements — one whose `implemented_by` `CodeChunk` overlaps a changed range, and one reached via a `validated_by` `Coverage` facet range overlapping the diff (carrying the test selector) — and flags a statement orphaned when the diff deletes its only covering range; it returns status `unavailable` when no dgraph client is given. `serializeRanges`/`parseRanges` round-trip the facet as comma-separated start-end pairs, dropping malformed parts. The rendered sticky PR comment shows a neutral skip when the graph is unavailable, coupled statements + orphan warnings otherwise, and "no impact" when clean. The impact CI workflow targets the workflows path, carries a version marker on its first line, triggers on `pull_request`, posts the diff to the impact endpoint with the same secret/var wiring as ingest, renders an advisory neutral check (never blocks), and grants the permissions to post checks and PR comments; a marker-version drift check reads the version and reports null/missing/stale/aligned. ([validated by `trace-impact:46`](libs/shared/src/spec-trace/trace-impact.test.ts#L46), [validated by `trace-impact:53`](libs/shared/src/spec-trace/trace-impact.test.ts#L53), [validated by `trace-impact:57`](libs/shared/src/spec-trace/trace-impact.test.ts#L57), [validated by `trace-impact:63`](libs/shared/src/spec-trace/trace-impact.test.ts#L63), [validated by `trace-impact:73`](libs/shared/src/spec-trace/trace-impact.test.ts#L73), [validated by `trace-impact:108`](libs/shared/src/spec-trace/trace-impact.test.ts#L108), [validated by `trace-impact:142`](libs/shared/src/spec-trace/trace-impact.test.ts#L142), [validated by `trace-impact:154`](libs/shared/src/spec-trace/trace-impact.test.ts#L154), [validated by `trace-impact:186`](libs/shared/src/spec-trace/trace-impact.test.ts#L186), [validated by `trace-impact:249`](libs/shared/src/spec-trace/trace-impact.test.ts#L249), [validated by `trace-impact:313`](libs/shared/src/spec-trace/trace-impact.test.ts#L313), [validated by `trace-impact:388`](libs/shared/src/spec-trace/trace-impact.test.ts#L388), [validated by `trace-impact-workflow:11`](libs/shared/src/trace-impact-workflow.test.ts#L11), [validated by `trace-impact-workflow:17`](libs/shared/src/trace-impact-workflow.test.ts#L17), [validated by `trace-impact-workflow:25`](libs/shared/src/trace-impact-workflow.test.ts#L25), [validated by `trace-impact-workflow:29`](libs/shared/src/trace-impact-workflow.test.ts#L29), [validated by `trace-impact-workflow:41`](libs/shared/src/trace-impact-workflow.test.ts#L41), [validated by `trace-impact-workflow:45`](libs/shared/src/trace-impact-workflow.test.ts#L45), [validated by `trace-impact-workflow:52`](libs/shared/src/trace-impact-workflow.test.ts#L52), [validated by `trace-impact-workflow:60`](libs/shared/src/trace-impact-workflow.test.ts#L60), [validated by `trace-impact-workflow:70`](libs/shared/src/trace-impact-workflow.test.ts#L70), [validated by `trace-impact-workflow:74`](libs/shared/src/trace-impact-workflow.test.ts#L74), [validated by `trace-impact-workflow:82`](libs/shared/src/trace-impact-workflow.test.ts#L82))

31. The Floor CI-ingest webhook turns a docs-ingest request into `internal.ingest.spec_trace` events:
   `mapCiIngest` emits one event per requested doc kind (`specs`/`adrs`) carrying `repo`/`kind`/`payload`
   (commit + force), preserves requested order, defaults to both kinds when omitted, and rejects a
   non-doc kind (naming it — test projection is CI-only) or a missing repo with a 400. The
   `POST /api/webhook/ci-ingest` route gates on the ingest bearer (503 unconfigured, 401 wrong), 400s a
   malformed or mapper-rejected body, and 500s when the event insert fails so the sender redelivers.
   ([validated by `ci-ingest-map.test.ts:5`](apps/floor/src/listeners/ci-ingest-map.test.ts#L5), [`ci-ingest-map.test.ts:29`](apps/floor/src/listeners/ci-ingest-map.test.ts#L29), [`ci-ingest-map.test.ts:61`](apps/floor/src/listeners/ci-ingest-map.test.ts#L61), [`ci-ingest-map.test.ts:70`](apps/floor/src/listeners/ci-ingest-map.test.ts#L70), [`ci-ingest-map.test.ts:85`](apps/floor/src/listeners/ci-ingest-map.test.ts#L85), [`ci-ingest-map.test.ts:95`](apps/floor/src/listeners/ci-ingest-map.test.ts#L95), [`ci-ingest.test.ts:28`](apps/floor/src/delivery/http/routes/ci-ingest.test.ts#L28), [`ci-ingest.test.ts:40`](apps/floor/src/delivery/http/routes/ci-ingest.test.ts#L40), [`ci-ingest.test.ts:52`](apps/floor/src/delivery/http/routes/ci-ingest.test.ts#L52), [`ci-ingest.test.ts:59`](apps/floor/src/delivery/http/routes/ci-ingest.test.ts#L59), [`ci-ingest.test.ts:71`](apps/floor/src/delivery/http/routes/ci-ingest.test.ts#L71))

32. The Floor CI-tests ingress feeds the graph a test report: `mapCiTests` maps a report body to one
   `internal.ingest.spec_trace` event (kind `test-report`) and rejects a missing repo/commit with a
   400; the `POST /api/webhook/ci-tests` route enforces the ingest bearer (503 unconfigured, 401
   wrong), 400s a malformed or invalid body (with the mapper message), and 500s a failed insert to
   force redelivery. ([validated by `ci-tests-map.test.ts:5`](apps/floor/src/listeners/ci-tests-map.test.ts#L5), [`ci-tests-map.test.ts:35`](apps/floor/src/listeners/ci-tests-map.test.ts#L35), [`ci-tests-map.test.ts:43`](apps/floor/src/listeners/ci-tests-map.test.ts#L43), [`ci-tests.test.ts:28`](apps/floor/src/delivery/http/routes/ci-tests.test.ts#L28), [`ci-tests.test.ts:40`](apps/floor/src/delivery/http/routes/ci-tests.test.ts#L40), [`ci-tests.test.ts:52`](apps/floor/src/delivery/http/routes/ci-tests.test.ts#L52), [`ci-tests.test.ts:59`](apps/floor/src/delivery/http/routes/ci-tests.test.ts#L59), [`ci-tests.test.ts:67`](apps/floor/src/delivery/http/routes/ci-tests.test.ts#L67))

33. `chunkFile` splits code by AST into a preamble chunk plus one chunk per top-level declaration: a leading comment block attaches to the following declaration's chunk, a comment before the first declaration becomes its own preamble chunk, an exported interface refines to `interface` and an exported type alias to `type`, a Python decorated definition unwraps to its inner name typed `function`, a Go `method_declaration` types as `function`, and code with no top-level declarations returns as one whole-file chunk; an unsupported language returns one whole-file chunk under the window size and splits into overlapping windows past 400 lines; markdown splits a preamble and each `##` section into its own titled chunk. ([validated by `attaches a leading comment block to the second declaration's chunk`](libs/shared/src/chunker.test.ts#L39), [validated by `emits a comment before the first declaration as its own preamble chunk`](libs/shared/src/chunker.test.ts#L56), [validated by `refines an exported interface to interface and an exported type alias to type`](libs/shared/src/chunker.test.ts#L76), [validated by `extracts the wrapped name and type from a Python decorated definition`](libs/shared/src/chunker.test.ts#L96), [validated by `types a Go method_declaration as function`](libs/shared/src/chunker.test.ts#L111), [validated by `returns the whole file as one chunk when the code has no top-level declarations`](libs/shared/src/chunker.test.ts#L126), [validated by `returns a single whole-file chunk for an unsupported language under the window size`](libs/shared/src/chunker.test.ts#L137), [validated by `splits an unsupported language over 400 lines into overlapping windows`](libs/shared/src/chunker.test.ts#L150), [validated by `splits a preamble and each ## section into its own titled chunk`](libs/shared/src/chunker.test.ts#L172))

34. `parseAdrRefs` extracts the distinct ADR numbers cited in statement text — normalizing zero-padding, matching a citation with a slug suffix, and empty when none is cited — and `adrNumberFromPath` reads the number from an ADR filename (null for a non-ADR path); this is the deterministic parse behind `DECIDED_BY → ADR`. ([validated by `extracts distinct ADR numbers, normalizing zero-padding`](libs/shared/src/spec-trace/adr-refs.test.ts#L5), [validated by `returns nothing when no ADR is cited`](libs/shared/src/spec-trace/adr-refs.test.ts#L10), [validated by `matches an ADR cited with a slug suffix`](libs/shared/src/spec-trace/adr-refs.test.ts#L15), [validated by `extracts the number from an ADR filename`](libs/shared/src/spec-trace/adr-refs.test.ts#L21), [validated by `returns null for a non-ADR path`](libs/shared/src/spec-trace/adr-refs.test.ts#L25))

35. `isAssertionSource` counts `spec` and `data-model` markdown as drift-assertion sources and excludes `research`/`plan`/`tasks`/`quickstart` docs, matching case-insensitively on the file basename rather than a parent directory of that name, and treating a trailing-slash path as a non-excluded source. ([validated by `excludes research docs`](libs/shared/src/detect/spec-drift-rules.test.ts#L38), [validated by `excludes plan docs`](libs/shared/src/detect/spec-drift-rules.test.ts#L42), [validated by `excludes tasks docs`](libs/shared/src/detect/spec-drift-rules.test.ts#L46), [validated by `excludes quickstart docs`](libs/shared/src/detect/spec-drift-rules.test.ts#L50), [validated by `is case-insensitive about the excluded basename`](libs/shared/src/detect/spec-drift-rules.test.ts#L54), [validated by `includes spec docs`](libs/shared/src/detect/spec-drift-rules.test.ts#L58), [validated by `includes data-model docs`](libs/shared/src/detect/spec-drift-rules.test.ts#L62), [validated by `matches on the basename, not a parent directory named research`](libs/shared/src/detect/spec-drift-rules.test.ts#L66), [validated by `treats a trailing-slash path as a non-excluded source`](libs/shared/src/detect/spec-drift-rules.test.ts#L70))

36. `Spec.content_hash` / `ADR.content_hash` is a completed-projection receipt, not an attempted-projection marker: the projector clears the persisted hash before writing any children and persists the new hash as the very last write, after every child (statements, sections, acceptance criteria, blocks, prunes) has succeeded. A projection that dies mid-file — e.g. a dgraph transaction abort under ingest contention — therefore leaves the freshness gate open and the next attempt re-projects the whole file (all writes are idempotent xid upserts); a completed hash skips an unchanged re-run and `force` bypasses the gate. Hash-first ordering left files permanently skipped with partial children after the 2026-07-16 recovery burst. ([validated by `agent-output hash gate spec death/retry`](libs/shared/src/spec-trace/projection-hash-gate.test.ts#L137), [validated by `Spec.content_hash is the final mutation`](libs/shared/src/spec-trace/projection-hash-gate.test.ts#L168), [validated by `hash skip + force re-project (spec)`](libs/shared/src/spec-trace/projection-hash-gate.test.ts#L188), [validated by `ADR death/retry reopens the gate`](libs/shared/src/spec-trace/projection-hash-gate.test.ts#L224), [validated by `ADR.content_hash is the final mutation`](libs/shared/src/spec-trace/projection-hash-gate.test.ts#L251), [validated by `hash skip + force re-project (ADR)`](libs/shared/src/spec-trace/projection-hash-gate.test.ts#L270); implemented by [`project-spec-file.ts:620`](libs/shared/src/spec-trace/project-spec-file.ts#L620), [`project-adr-file.ts:61`](libs/shared/src/spec-trace/project-adr-file.ts#L61))

37. Every spec-trace dgraph write survives contention: `withTxn` retries an aborted/conflicted transaction on a FRESH transaction (an aborted dgraph txn is finished; the driver folds write-write conflicts into the same "Transaction has been aborted. Please retry" Error, so `isTxnAborted` matches the message the way the driver itself does) across the `TXN_ABORT_DELAYS_MS = [200, 500, 1000]` schedule — deliberately ms-scale, not the event loop's 1-300s backoff, so a many-write ingest stays inside the 600s stuck-row reaper budget — while every attempted transaction is still discarded and any non-abort error rethrows immediately. Safe because all spec-trace writes are idempotent xid upserts. ([validated by `dgraph-upsert:213`](libs/shared/src/spec-trace/dgraph-upsert.test.ts#L213), [validated by `dgraph-upsert:228`](libs/shared/src/spec-trace/dgraph-upsert.test.ts#L228), [validated by `dgraph-upsert:239`](libs/shared/src/spec-trace/dgraph-upsert.test.ts#L239), [validated by `dgraph-upsert:250`](libs/shared/src/spec-trace/dgraph-upsert.test.ts#L250), [validated by `dgraph-upsert:263`](libs/shared/src/spec-trace/dgraph-upsert.test.ts#L263); implemented by [`dgraph-upsert.ts:44`](libs/shared/src/spec-trace/dgraph-upsert.ts#L44))

38. `runIngestGraph` prunes whole subtrees for graph docs whose files left the repo tree (a moved or deleted spec/ADR no longer haunts the graph or the web-UI). After the projection loop, docs in scope for the run but absent from the tree selection are deleted: a Spec with its Statements, Sections, AcceptanceCriteria, TraceLinks, Blocks and the `Repo.specs` edge — while a sibling spec survives intact — and an ADR with its Blocks, the `Repo.adrs` edge, and incoming `decided_by`/`supersedes`/TraceLink refs. Link-target chunks are GC'd only when nothing else owns them (a TestChunk still validated by another spec, or carrying coverage, survives; a solely-owned one is deleted) and the owning Feature only when its last spec goes. The prune runs even when every current file hash-skipped (a moved file's OLD path never re-projects, so freshness gives no signal), re-runs are no-ops, and it is guarded: an empty tree selection prunes nothing (a bad or partial tree read must never wipe the graph), an all-failed run prunes nothing, a glob-chunked run prunes only inside its own directory (candidates pass the same selection filter that produced the tree files), and a prune failure is per-candidate isolated with the deleted count reported as `pruned` in the summary — while a failed doc-list read reports `pruned` as absent (didn't run), never a misleading `pruned 0` that reads as a clean reconcile. ([validated by `prune-removed-docs:19`](libs/shared/src/spec-trace/prune-removed-docs.test.ts#L19), [validated by `prune-removed-docs:29`](libs/shared/src/spec-trace/prune-removed-docs.test.ts#L29), [validated by `prune-removed-docs:35`](libs/shared/src/spec-trace/prune-removed-docs.test.ts#L35), [validated by `prune-removed-docs:45`](libs/shared/src/spec-trace/prune-removed-docs.test.ts#L45), [validated by `prune-removed-docs:166`](libs/shared/src/spec-trace/prune-removed-docs.test.ts#L166), [validated by `prune-removed-docs:202`](libs/shared/src/spec-trace/prune-removed-docs.test.ts#L202), [validated by `prune-removed-docs:239`](libs/shared/src/spec-trace/prune-removed-docs.test.ts#L239), [validated by `prune-removed-docs:267`](libs/shared/src/spec-trace/prune-removed-docs.test.ts#L267), [validated by `prune-removed-docs:281`](libs/shared/src/spec-trace/prune-removed-docs.test.ts#L281), [validated by `prune-removed-docs:314`](libs/shared/src/spec-trace/prune-removed-docs.test.ts#L314), [validated by `ingest-graph-task:250`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L250), [validated by `ingest-graph-task:271`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L271), [validated by `ingest-graph-task:288`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L288), [validated by `ingest-graph-task:308`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L308), [validated by `ingest-graph-task:327`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L327), [validated by `ingest-graph-task:347`](libs/shared/src/spec-trace/ingest-graph-task.test.ts#L347); implemented by [`prune-removed-docs.ts:88`](libs/shared/src/spec-trace/prune-removed-docs.ts#L88), [`ingest-graph-task.ts:367`](libs/shared/src/spec-trace/ingest-graph-task.ts#L367))

39. The `POST /api/repos/:o/:r/ingest-graph` REST trigger inserts one `internal.ingest.spec_trace` event for a requested docs kind (`specs`/`adrs`) and creates no pipeline task, rejecting the `tests` kind with a 400 (test projection is CI-only). The shared `triggerAgentSpecTrace` it delegates to performs that event insert carrying `repo`/`kind`/`payload`. ([validated by `ingest-graph:40`](apps/lore-api/src/api/routes/ingest/ingest-graph.test.ts#L40), [validated by `ingest-graph:49`](apps/lore-api/src/api/routes/ingest/ingest-graph.test.ts#L49), [validated by `spec-trace-trigger:18`](apps/lore-api/src/api/routes/spec-trace-trigger.test.ts#L18); implemented by [`ingest-graph.ts:1`](apps/lore-api/src/api/routes/ingest/ingest-graph.ts#L1))

## Limitations & Open Questions

1. **Per-test coverage attribution is tooling-dependent** (LCOV `TN:` vs Go per-file aggregate). Owned + documented by [`project-test-interface`](../project-test-interface/spec.md); the graph just stores whatever granularity arrives.
2. **Symbol-level granularity needs a grammar.** Where tree-sitter has no grammar, nodes are file+line only and `symbol_name` is null — still fully functional, just coarser. Adding grammars is incremental.
3. **Monorepo path mapping.** Coverage paths must be normalized repo-relative to join `chunks.file_path`; the CI template / test-command manifest owns normalization.
4. **Generation provenance only covers generated code.** Human-written/legacy code falls to the coverage-bridged or LLM-suggested tiers; coverage shrinks the LLM shortlist.
5. **Test-command execution trust boundary** is owned by [`project-test-interface`](../project-test-interface/spec.md) (opt-in, sandboxed, never on the long-lived services); out of scope for the graph, which only ingests output.
6. **Statement embedding cost.** Embedding each statement adds Vertex calls at projection time (not LLM generation). Mitigation: reuse spec-chunk embeddings where statement granularity is unnecessary; embed only testable statements.
7. **Provenance drift.** If a generated link's `ordinal` no longer matches a statement after a spec edit, the projection skips it with a warning (same behaviour as the v3 backfill's `proposeLinkInsertions`).
8. **The projection ran in-process in the Floor** — *(resolved late 2026-07)* the direction sketched here shipped as [`specs/ingest-station/`](../ingest-station/spec.md): the whole `internal.ingest.*` family (docs projection, test-report/coverage ingest, the post-ingest `spec_coverage_validate` pass) now runs on detect-shaped assembly lines with an `ingest` station (`libs/assembly-lines/src/assembly-lines/ingest.yaml`, `apps/lore-station/src/stations/ingest.ts`); the Floor's handlers only start assembly lines, and no in-process dgraph writer remains (`specs/floor-event-bus/` FR9's production serial-family set is empty because of this).
