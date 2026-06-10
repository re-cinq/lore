# Implementation Plan: Spec Traceability Graph

| Field   | Value                                          |
|---------|------------------------------------------------|
| Feature | Spec Traceability Graph                        |
| Spec    | [spec.md](spec.md)                             |
| Data    | [data-model.md](data-model.md)                 |
| Depends | [memory-dgraph-migration](../memory-dgraph-migration/plan.md) (shared Dgraph cluster + client); [project-test-interface](../project-test-interface/plan.md) (test/coverage inputs — built first) |
| Status  | Draft                                          |
| Created | 2026-06-05                                     |

## Overview

Build a derived spec→test→code→coverage graph in the shared Dgraph
cluster, as small, per-changed-file, **zero-LLM** background units that
also run locally. Markdown stays the source of truth; the graph rebuilds
from segmentation + parsed links + AST chunks + coverage. The
highest-value piece — links captured at generation time and verified by
coverage — is sequenced early so the rest (drift, vectors, UI) builds on
real edges.

This feature depends on the shared `dgraph-client` from
[`memory-dgraph-migration`](../memory-dgraph-migration/plan.md). It can be
developed against the same local Dgraph container.

## Phase 0: Shared primitives

### 0.1 Move segmentation to `shared/`

**Files:** `shared/src/spec-segment.ts` (moved from `web-ui/src/lib/`),
`shared/src/spec-link-parser.ts`, `shared/src/test-paths.ts`

`segmentStatements`/`classifyByHeuristic` become shared so agent +
mcp-server + web-ui import one copy. Broaden `isTestFile` across
languages (pytest `test_*.py`, JUnit `*Test.java`, Rust `#[test]`/
`_test.rs`, RSpec `_spec.rb`, .NET, PHP, …). Add a code-link parse
(non-test paths) to `spec-link-parser` for `IMPLEMENTED_BY`.

### 0.2 Per-chunk content hash

**Files:** `shared/src/chunker.ts`, `mcp-server/src/ingest.ts`,
`agent/src/jobs/cron/reindex.ts`

Compute `metadata.content_hash = sha256(chunk.content)` in `chunkFile()`;
persist it at both ingest paths. No DDL (lives in `chunks.metadata`
JSONB). (Optional, incremental: add tree-sitter grammars beyond
TS/JS/PY/GO — Rust/Java/Kotlin/C#/Ruby/PHP/C/C++/Swift — with the
existing sliding-window fallback for the rest.)

## Phase 1: Projection unit

**File:** `shared/src/spec-trace/project-spec-file.ts` (NEW)

`projectSpecFile(repo, file_path, content, dgraph)` — pure, idempotent,
zero-LLM: segment → upsert `Spec`/`Section`/`Statement`; parse test links
→ `resolveTestLink` → upsert `TestChunk` + `VALIDATED_BY`; parse code
links → `IMPLEMENTED_BY`. Gated on `Spec.content_hash`. Test-name
resolution via the fallback chain (label → AST symbol → language pattern).

## Phase 2: Generation-time provenance capture

**Files:** `shared/src/spec-trace/provenance.ts` (NEW),
`shared/src/commit-trailers.ts`, generation prompt templates
(`scripts/task-types.yaml` / supervisor)

- Add `Lore-Validates:` to the trailer vocabulary
  (`shared/src/commit-trailers.ts`).
- `provenance.ts`: deterministic parsers for the inline spec link, the
  `// lore:validates specs/…#N` annotation, and the `Lore-Validates:`
  trailer; the most specific wins; discrepancies logged. Zero LLM.
- Extend the implementation/feature task prompt so the generating agent
  emits all three forms in the PR it opens. The auto-review-loop merge
  ratifies (promotes to `generated-provenance` / `human-linked`).

## Phase 3: Coverage ingest + coverage-first verification

**Files:** `mcp-server/src/routes/coverage.ts` (NEW),
`shared/src/spec-trace/ingest-coverage.ts` (NEW)

- `POST /api/repos/:o/:r/coverage` (write scope) — parse LCOV/Cobertura
  (zero-LLM) → `ingestCoverageReport()` upserts `Coverage` nodes +
  `COVERS` edges by line overlap; idempotent on `commit`.
- Coverage-first verification: mark declared links `execution-verified`
  when a covering test's coverage overlaps the named code; flag
  `link-unproven` when a linked test covers nothing relevant.

## Phase 4: Drift unit + confidence tiers

**File:** `shared/src/spec-trace/drift-check-file.ts` (NEW)

`driftCheckFile(repo, file_path, newChunks, dgraph)` — compare each
chunk's new `content_hash` to its Dgraph node; on change, reverse-traverse
`IMPLEMENTED_BY` **and** the coverage chain to affected statements; set
`drifted=true` + `drift_reason`; mark the `Coverage` stale; update stored
hash. Fold in link rot. Grade severity by statement↔chunk cosine.

## Phase 5: Vectors (candidate suggestion) + LLM legacy fallback

**Files:** `shared/src/spec-trace/project-spec-file.ts` (vector mirror),
`shared/src/spec-trace/suggest-links.ts` (NEW, LLM fallback)

- Mirror chunk embeddings onto `CodeChunk`/`TestChunk`; embed testable
  `Statement`s once.
- `similar_to` candidate suggestion for un-linked statements
  (deterministic). LLM judge only for the legacy tail, over the
  vector+coverage-narrowed shortlist, suggest-not-decide (reuses the v3
  `spec-coverage-backfill` judge + `proposeLinkInsertions` PR opener).

## Phase 6: Consume the test interface (built first, separate feature)

Test discovery, per-test coverage, the manifest + `tests.list`/`tests.run`,
the ingest endpoints, the sandboxed executor, and the closed-loop
re-verification are all delivered by
[`project-test-interface`](../project-test-interface/plan.md), which ships
**before** this graph. Here we only **consume** its output:
`ingestCoverageReport()` and the projection units accept the posted
descriptors / coverage / `violated` signal and write the graph. No
test-runner code lives in this feature.

## Phase 7: Dispatcher + triggers + UI

**Files:** `agent/src/jobs/scheduled/spec-trace.ts` (NEW),
`agent/src/health.ts`, `scripts/trace/*.ts`,
`web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.tsx`,
issue machinery (`spec-drift` label)

- Thin dispatcher fans out one unit per changed file from the reindex
  change set; each unit independently retriable; a failure never blocks
  ingest or siblings.
- Trigger from the post-ingest hook (alongside `spec-coverage-validate`).
- Local CLIs: `trace:project`, `trace:ingest-coverage`, `trace:drift`.
- Surface drift via a `spec-drift`-labelled issue (reuse the broken-links
  report shape) + per-statement evidence/drift badges on the spec-detail
  page.

## Files Changed Summary

| File | Phase | Change |
|------|-------|--------|
| `shared/src/spec-segment.ts` | 0 | moved from web-ui (shared) |
| `shared/src/spec-link-parser.ts`, `test-paths.ts` | 0 | code-link parse; broaden `isTestFile` |
| `shared/src/chunker.ts` + 2 ingest paths | 0 | `content_hash` in metadata |
| `shared/src/commit-trailers.ts` | 2 | `Lore-Validates:` |
| `shared/src/spec-trace/project-spec-file.ts` | 1,5 | projection + vector mirror |
| `shared/src/spec-trace/provenance.ts` | 2 | provenance parsers |
| `shared/src/spec-trace/ingest-coverage.ts` | 3 | consume posted coverage/report → Coverage + COVERS |
| `shared/src/spec-trace/drift-check-file.ts` | 4 | drift + tiers (+ `violated` from project-test-interface) |
| `shared/src/spec-trace/suggest-links.ts` | 5 | LLM legacy fallback |
| _test interface_ (`test-command-runner.ts`, `/api/coverage`, `/test-report`, MCP tools, CI templates) | — | **owned by [`project-test-interface`](../project-test-interface/plan.md)** (built first); consumed here |
| `agent/src/jobs/scheduled/spec-trace.ts` | 7 | dispatcher |
| `agent/src/health.ts` | 7 | trigger |
| `scripts/trace/*.ts` | 7 | local CLIs |
| `web-ui/.../SpecDetails.tsx` + issue machinery | 7 | badges + `spec-drift` label |
| generation prompt templates | 2 | emit provenance |

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Over-reliance on LLM linking | Generation-time provenance (primary) + coverage verification; LLM is legacy-tail suggest-only |
| Language coverage gaps | File+line+hash + LCOV are language-neutral; symbols/test-name are optional enrichment |
| Projection non-determinism → false drift | Deterministic `segmentStatements` ordinals; gate on `content_hash`; shared client/UI |
| Coverage attribution per-test missing | `test_name='*'` aggregate fallback (documented); still beats name-overlap |
| Test-command execution = arbitrary code | Opt-in + sandboxed; local/CI only; never arbitrary cluster exec |
| Statement embedding cost | Embed testable statements only; reuse spec-chunk embeddings where coarse is fine |
| Monorepo path mismatch | CI template / manifest normalizes paths repo-relative before upload |

## Testing Strategy

- **Pure units, real values, no mocks**: `segmentStatements`,
  `parseTestLinksInStatement`, `resolveTestLink`, provenance parsers,
  LCOV/Cobertura parsers, `content_hash`.
- **Graph units against real local Dgraph**: `projectSpecFile`,
  `ingestCoverageReport`, `driftCheckFile` with real lcov fixtures.
- **Drift e2e**: change an implementation chunk (not its test), assert the
  connected statement flips `drifted` via the coverage chain.
- **Language-agnostic**: a fixture in a language with no grammar still
  produces file+line nodes + coverage `COVERS` + drift.
- **Determinism**: delete the graph, re-run units, assert identical graph.

## ADR Reference

Extends [ADR-008 (AST chunking enables drift detection)](../../adrs/ADR-008-ast-chunking-via-tree-sitter.md)
and the v3 spec-test-coverage direction. A follow-up ADR should record:
the graph-as-derived-projection decision, generation-time provenance as
the primary linking mechanism, and the coverage-first confidence model.
