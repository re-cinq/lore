# Tasks: Spec → Test Coverage

## Phase 1 — Data layer

- [x] T001 Add migration `terraform/modules/gke-mcp/ui-helm/migrations/NNNN_spec_test_links.sql` creating `{schema}.spec_test_links` + indexes per team schema, idempotent (`IF NOT EXISTS`), tracked in `lore.schema_migrations`
- [x] T002 [P] Add `isTestFile(filePath)` path heuristics (`.test.`, `.spec.`, `_test.`, `__tests__/`, `*_test.go`) in `agent/src/lib/test-paths.ts`
- [x] T003 [P] Add `normalizeTestName(describe, it)` (lowercase, collapse whitespace, ` › ` join) in `agent/src/lib/test-paths.ts`
- [x] T004 [P] Unit tests for `test-paths.ts` in `agent/src/lib/test-paths.test.ts` (positive/negative path cases, name normalization)

## Phase 2 — Linker job

- [x] T005 Add candidate-selection pure function `selectCandidates(spec, assertions, codeChunks)` (assertion overlap + directory affinity + embedding proximity, capped at `MAX_CANDIDATES_PER_SPEC`, returns truncation flag) in `agent/src/jobs/spec-test-linker.ts`
- [x] T006 Add `judgeLink(spec, testChunk)` LLM call returning `{ matches, rationale }` via `callLLMWithTool` (reuse `spec_drift`/new `spec_test_linker` jobName for cache), in `agent/src/jobs/spec-test-linker.ts`
- [x] T007 Add upsert + stale-prune persistence (`ON CONFLICT ... DO UPDATE`, prune keys no longer confirmed this run) in `agent/src/jobs/spec-test-linker.ts`
- [x] T008 Wire `specTestLinkerJob()` orchestration: reuse `extractAssertions` + activity pre-filter (mirror `spec-drift.ts`), `isAssertionSource` gate, per-repo loop, candidate cap truncation logging
- [x] T009 [P] Unit tests `agent/src/jobs/spec-test-linker.test.ts` (candidate selection, cap+truncation log, stale-prune logic) — pure functions only, no live LLM
- [x] T010 Register `specTestLinkerJob` on a weekly schedule in `agent/src/index.ts`

## Phase 3 — API

- [x] T011 Add `GET /api/repos/:owner/:repo/spec-coverage` handler in `mcp-server/src/routes.ts`: resolve schema, join `spec_test_links` ⨝ spec chunks, reassemble title/summary, compose source URLs, return payload (read scope, bearer auth)
- [x] T012 [P] Add pure `parseSpecTitle()` + `extractSummary()` + `reassembleSpec()` — canonical in `shared/src/spec-summary.ts` (used by API), mirrored in `web-ui/src/lib/spec-summary.ts` (used by page); unit tests both sides

## Phase 4 — Web UI

- [x] T013 [P] Build `SpecCard.tsx` (title, file_path, summary, coverage line, Details button; zero-test gap state) in `web-ui/src/app/repos/[owner]/[repo]/specs/`
- [x] T014 [P] Build `SpecDetails.tsx` client component: `react-markdown` + `remark-gfm` + `rehype-raw` full-spec render (reassembled chunks) + matched test list with source links + expandable rationale
- [x] T015 Details surface = **route** `/repos/:o/:r/specs/[...path]` (catch-all, `encodeURIComponent` contract per web-ui CLAUDE.md); navigation wired from `SpecCard`
- [x] T016 Rewrite `web-ui/src/app/repos/[owner]/[repo]/specs/page.tsx`: DB-direct coverage (spec chunks + link counts) → `SpecCard` list, **Add Spec form preserved unchanged**
- [x] T017 [P] Styling reuses existing `spec-card` / `content-viewer` / `btn-secondary` classes + inline styles (no new CSS file needed)

## Phase 5 — Verify (v1)

- [x] T018 Typecheck (shared/agent/mcp-server/web-ui all clean) + test suites green: shared 76, agent 368, web-ui 112. AC 1–10 satisfied by implementation.

> **v1 → v2 transition.** Commit `87c7872` rewrote `spec.md` + `data-model.md` to add **statement-level** coverage (segmentation, classification, `CoverageBar`, hash-gate freshness, rehype highlighter) — **none of which were implemented**. v1 (whole-spec linking, flat test list) shipped in `ed947d4`. Phases 6–14 below close the v2 gap; T019 is deferred until v2 lands.

## Phase 6 — v2 data migrations

- [x] T020 [P] Add migration `terraform/modules/gke-mcp/ui-helm/migrations/0004_spec_statements.sql` creating `{schema}.spec_statements` per team schema (idempotent, `UNIQUE (repo, spec_path, ordinal)`, `spec_statements_spec_idx`)
- [x] T021 [P] Add migration `terraform/modules/gke-mcp/ui-helm/migrations/0005_spec_coverage_runs.sql` creating `{schema}.spec_coverage_runs` (PK `(repo, spec_path)`, `content_hash`, `run_at`)
- [x] T022 [P] Add migration `terraform/modules/gke-mcp/ui-helm/migrations/0006_spec_test_links_statement_cols.sql` additive `ALTER TABLE {schema}.spec_test_links ADD COLUMN IF NOT EXISTS statement_ordinal INTEGER, statement_text TEXT, match_score REAL` + `spec_test_links_stmt_idx (repo, spec_path, statement_ordinal)`

## Phase 7 — Statement segmentation (shared, pure)

- [x] T023 Create `shared/src/spec-segment.ts` exporting `segmentStatements(content)` — deterministic sentence + list-item splitter (`.?!` w/ abbreviation guard; each list item a statement; headings/fenced code/tables excluded; tracks enclosing heading). **Deviation:** spec.md File Changes lists `agent/src/lib/spec-segment.ts`; placed in `shared/` to follow T012's canonical-in-shared pattern so agent + web-ui + mcp-server all import from `@re-cinq/lore-shared`.
- [x] T024 [P] Unit tests `shared/src/__tests__/spec-segment.test.ts` (abbreviation guard, list items, headings/code/tables excluded, ordinal determinism across re-runs) — 20 passing
- [x] T025 Re-export `segmentStatements` (and the classifier helpers from T026) from `shared/src/index.ts`; verify agent + web-ui resolve them

## Phase 8 — Statement classifier

- [x] T026 Add `classifyByHeuristic(statement, enclosingHeading)` to `shared/src/spec-segment.ts` — section heuristic (Problem Statement / Vision / Background / Clarifications / Open Questions / Limitations / Rationale + H1/intro → `untestable` w/ category). Errs toward `testable` on ambiguity (false-red is visible, false-grey hides gaps).
- [x] T027 Add `classifyLLM(unclassified[])` to `agent/src/jobs/cron/spec-test-linker.ts` — batched one-shot LLM fallback for statements the heuristic doesn't catch, via `callLLMWithTool` with the existing `spec_test_linker` jobName for cache reuse
- [x] T028 [P] Tests for classifier — heuristic matches return correct category, ambiguous default `testable` (covered in shared spec-segment.test.ts § classifyByHeuristic, 8 cases)

## Phase 9 — Linker refactor (statement-level + hash gate)

- [x] T029 Content-hash freshness gate in `agent/src/jobs/cron/spec-test-linker.ts`: read `spec_coverage_runs.content_hash`, hash `reassembleSpec()` output, skip spec on unchanged hash, write hash on successful run
- [x] T030 Refactor `judgeLink()` to accept the spec's enumerated testable statements and return `{ matches, statement_ordinal, score, rationale }`
- [x] T031 Add `argmaxByTest()` best-match dedup — per `(test_file, test_name)` keep only the row with highest `match_score`; drop rows below `τ_score` (0.5)
- [x] T032 Persist statements: upsert `spec_statements` rows; prune ordinals no longer present this run (matching `staleLinkKeys` pattern)
- [x] T033 Extend `persistLinks()` to write `statement_ordinal`, `statement_text`, `match_score` columns
- [x] T034 [P] Tests for hash gate, judge return shape, argmax dedup, statement upsert+prune, link statement-column writes — hashSpecContent (3), staleStatementOrdinals (3), argmaxByTest (4); 32 tests passing

## Phase 10 — API payload extension

- [ ] T035 Extend `GET /api/repos/:owner/:repo/spec-coverage` in `mcp-server/src/routes.ts`: query `spec_statements` for the full statements array; compute `coverage.{testable, covered, untestable}`; include per-test `statement_ordinal` + `match_score`; payload shape per `data-model.md` §Coverage API payload
- [ ] T036 [P] Tests for the new payload shape (route handler unit test or fixture-based)

## Phase 11 — CoverageBar component

- [ ] T037 Build `web-ui/src/components/CoverageBar.tsx` — stacked three-segment bar (`tested / untested / fluff`), widths over **all** statements, caption `tested / (tested + untested)`, theme tokens `--success` / `--danger` / `--text-muted`, non-colour cues (label/icon per segment), muted-empty state when zero testable
- [ ] T038 [P] Tests for `CoverageBar` (width math, empty state, caption formula, non-colour cue present per segment)

## Phase 12 — SpecCard + per-repo specs page

- [ ] T039 Update `web-ui/src/app/repos/[owner]/[repo]/specs/SpecCard.tsx` to replace inline test-count with `<CoverageBar>` + caption (mockup at spec.md §Card list)
- [ ] T040 Update `web-ui/src/app/repos/[owner]/[repo]/specs/page.tsx` to fetch the extended coverage payload; **Add Spec form preserved unchanged** (AC13)

## Phase 13 — SpecDetails statement highlighting

- [ ] T041 Rehype highlight plugin in `web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.tsx` (or sibling) that wraps each statement's longest contiguous text run in `<mark class="stmt-state-{green|red|grey}">`
- [ ] T042 Hover popovers (reuse `HelpPopover` pattern): green → validating test names + source deep-links + rationale; grey → untestable category
- [ ] T043 Add `<CoverageBar>` to the details header
- [ ] T044 Flag list-only links (un-anchored) in the retained test list; pre-existing whole-spec rows degrade gracefully until next re-link (AC12)
- [ ] T045 [P] Tests for the rehype plugin (full-statement contiguous wrap, formatting-mixed statement falls back without throwing)

## Phase 14 — Verify (v2)

- [ ] T046 Typecheck + test suites green across `shared/`, `agent/`, `mcp-server/`, `web-ui/`; all 13 v2 ACs satisfied
- [ ] T019 Manual UI walkthrough — `npm start`, browse `/repos/{owner}/{repo}/specs`, verify `CoverageBar` on cards, hover green statement → tests + rationale, hover grey → category, red statement visibly a gap, non-colour cue visible, Add Spec form still works
