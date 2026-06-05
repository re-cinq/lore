# Tasks: Spec Traceability Graph

Implements [`spec.md`](./spec.md) + [`data-model.md`](./data-model.md) +
[`plan.md`](./plan.md). Test discovery / coverage / the manifest are
delivered by [`project-test-interface`](../project-test-interface/tasks.md)
(built first); this list **consumes** that output.
Strict TDD — red→green→refactor, real values, **no mocks** (graph units
run against a real local Dgraph container; coverage units use real lcov
fixtures). `[P]` = parallelizable. Test names use tested-value +
expected-outcome (no "should"). Depends on the shared `dgraph-client`
from [`memory-dgraph-migration`](../memory-dgraph-migration/tasks.md) T004.

## Phase 0 — Shared primitives

- [ ] T201 Move `segmentStatements`/`classifyByHeuristic` to `shared/src/spec-segment.ts`; re-export from `@re-cinq/lore-shared`; web-ui + agent + mcp-server import the shared copy. Existing segmentation tests stay green.
- [ ] T202 [P] Broaden `isTestFile` in `shared/src/test-paths.ts` across languages (pytest `test_*.py`/`*_test.py`, JUnit `*Test.java`/`*Tests.kt`, Rust `_test.rs`/`#[test]`, RSpec `_spec.rb`, .NET `*Tests.cs`, PHP `*Test.php`). Tests: positive/negative per language.
- [ ] T203 [P] Add a code-link parse (non-test paths) to `shared/src/spec-link-parser.ts` for `IMPLEMENTED_BY`. Test: a trailing paren with a non-test path yields a code-link ref; test paths still route to test links.
- [ ] T204 RED: test `sha256(chunk.content)` is stable for identical content and differs for changed content. GREEN: compute `metadata.content_hash` in `shared/src/chunker.ts`. REFACTOR.
- [ ] T205 Persist `content_hash` at both ingest paths (`mcp-server/src/ingest.ts`, `agent/src/jobs/cron/reindex.ts`); test the metadata round-trips through a chunk insert.
- [ ] T206 [P] (Optional, incremental) add a tree-sitter grammar (e.g. Rust) + test symbol extraction; confirm the sliding-window fallback still yields file+line chunks for an un-grammared language.

## Phase 1 — Projection unit

- [ ] T210 RED: `agent/src/spec-trace/__tests__/project-spec-file.test.ts` against real Dgraph — a spec with two statements and one `([validated by](t.test.ts#L42))` link projects `Spec`/`Section`/`Statement` nodes (deterministic `xid`) + a `TestChunk` with the right `test_name` + a `VALIDATED_BY` edge.
- [ ] T211 GREEN: implement `projectSpecFile()`; resolve links via `resolveTestLink`; test-name fallback chain (label → AST symbol → language pattern). REFACTOR.
- [ ] T212 [P] Test: re-running on unchanged content (same `Spec.content_hash`) is a no-op; a reworded statement changes `Statement.text_hash`.
- [ ] T213 [P] Test: zero LLM calls during projection (assert no LLM client invocation).

## Phase 2 — Generation-time provenance

- [ ] T220 Add `Lore-Validates:` to `shared/src/commit-trailers.ts` (parse + format); tests for round-trip + `lastStageOnBranch`-style extraction.
- [ ] T221 RED: `agent/src/spec-trace/__tests__/provenance.test.ts` — parse the inline spec link, the `// lore:validates specs/foo/spec.md#7` annotation (and `#`-comment variant), and the `Lore-Validates:` trailer into a common `{spec_path, ordinal, target}` shape; conflicting forms resolve to the most specific + log. GREEN: implement `provenance.ts`. REFACTOR.
- [ ] T222 [P] Extend the implementation/feature generation prompt (`scripts/task-types.yaml` / supervisor) to emit all three provenance forms; document the format in the prompt. (Prompt-template change; verified by a render/snapshot test.)
- [ ] T223 Test: a generated edge carries `evidence=generated-provenance`; PR-merge ratification promotes it (tier transition covered).

## Phase 3 — Coverage ingest + verification

- [ ] T230 RED: `agent/src/spec-trace/__tests__/ingest-coverage.test.ts` with a real LCOV fixture (incl. `TN:` per-test + a `DA:` block) → `Coverage` node per test + `COVERS` edges to the overlapping `CodeChunk`s; unmatched lines dropped with a logged count. GREEN: implement `ingestCoverageReport()` (LCOV + Cobertura). REFACTOR.
- [ ] T231 [P] Test: idempotent on `Coverage.commit` (re-ingesting the same commit is a no-op); a new commit replaces.
- [ ] T232 Build `POST /api/repos/:o/:r/coverage` in `mcp-server/src/routes/coverage.ts` (write scope, bearer auth); fires the `spec-trace` trigger. Tests: parse + persist + trigger fan-out.
- [ ] T233 Coverage-first verification: a declared link whose covering test overlaps the named code is marked `execution-verified`; a linked test covering nothing relevant is flagged `link-unproven`. Tests for both.

## Phase 4 — Drift unit + tiers

- [ ] T240 RED: `agent/src/spec-trace/__tests__/drift-check-file.test.ts` against real Dgraph — change an **implementation** chunk's content (its test unchanged); assert the connected `Statement` flips `drifted=true`, `drift_reason="code-content-changed (...)"` via the coverage chain. GREEN: implement `driftCheckFile()`. REFACTOR.
- [ ] T241 [P] Test: link rot (file-missing / line-out-of-range) flagged with distinct `drift_reason` in the same pass.
- [ ] T242 [P] Test: evidence tiers ordered correctly (`execution-verified`/`generated-provenance` > `human-linked` > `coverage-bridged` > `llm-suggested`); status derivation (`verified-implemented`/`claimed`/`untested`).
- [ ] T243 [P] Graded severity: statement↔changed-chunk cosine distance attached to the drift flag.

## Phase 5 — Vectors + LLM legacy fallback

- [ ] T250 Mirror chunk embeddings onto `CodeChunk`/`TestChunk`; embed testable `Statement`s once in `projectSpecFile`. Test: embeddings present, dim==768.
- [ ] T251 RED/GREEN: `similar_to` candidate suggestion for an un-linked statement returns the nearest code/test deterministically (no LLM). Test against real vectors.
- [ ] T252 [P] LLM legacy fallback `agent/src/spec-trace/suggest-links.ts` — reuse the v3 `spec-coverage-backfill` judge + `proposeLinkInsertions` PR opener over the vector+coverage shortlist; suggest-not-decide; tests cover shortlist narrowing + that no edge is marked authoritative without ratification.

## Phase 6 — Consume the test interface (separate feature, built first)

The manifest, `tests.list`/`tests.run`, the sandboxed executor, the
ingest endpoints, the MCP tools, and closed-loop re-verification are
delivered by [`project-test-interface`](../project-test-interface/tasks.md).

- [ ] T260 Consume its output here: `ingest-coverage` + projection accept the posted descriptors / coverage / `violated` signal and write the graph (`TestChunk`, `Coverage`, `COVERS`, `VALIDATED_BY`, `violated`). No test-runner code in this feature. Test against fixtures shaped like the contract's `tests.list`/`tests.run`/`test-report` payloads.

## Phase 7 — Dispatcher + triggers + UI

- [ ] T270 Build `agent/src/jobs/scheduled/spec-trace.ts` dispatcher — fans one unit per changed file from the reindex change set; a failed unit never blocks ingest or siblings. Test the fan-out + isolation.
- [ ] T271 Trigger `spec-trace` from the post-ingest hook in `agent/src/health.ts` (alongside `spec-coverage-validate`).
- [ ] T272 [P] Local CLIs `scripts/trace/{project-file,ingest-coverage,drift}.ts` + npm scripts `trace:project` / `trace:ingest-coverage` / `trace:drift`. Test: run against the local Dgraph over a fixture working tree, zero LLM.
- [ ] T273 [P] `spec-drift` issue surfacing (reuse `formatBrokenLinksReport()` shape) + add the label to the issue machinery.
- [ ] T274 [P] `web-ui/.../SpecDetails.tsx` per-statement evidence + drift badges sourced from the graph.

## Phase 8 — Verify

- [ ] T280 Typecheck clean across `shared/`, `agent/`, `mcp-server/`, `web-ui/`; full suites green.
- [ ] T281 Determinism: delete the whole traceability subgraph, re-run all units from markdown + chunks + coverage, assert an identical graph.
- [ ] T282 Manual e2e: ingest a repo with a linked spec → graph shows `Statement→TestChunk` (right `test_name`); POST lcov → `Coverage`/`COVERS`; edit the implementation (not the test) → re-ingest → statement flips `drifted` + `spec-drift` issue/badge appears.
- [ ] T283 Language-agnostic e2e: repeat T282 for a language with no tree-sitter grammar; confirm file+line nodes + coverage + drift still work.

## Phase 9 — Follow-ups (deferred)

- [ ] F-cluster-sandbox Evaluate a confined cluster sandbox for opt-in test-command execution (currently local/CI only).
- [ ] F-impl-via-coverage Auto-derive `IMPLEMENTED_BY` purely from the coverage chain for statements with no direct code link.
- [ ] F-grammars Add the remaining tree-sitter grammars (Kotlin/C#/PHP/C/C++/Swift) for symbol-level granularity.
- [ ] F-severity-policy Tune drift-severity thresholds (cosine bands) and which severities open issues vs only badge.
