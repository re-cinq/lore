# Tasks: Spec → Test Coverage (v3)

Implements [`specs/spec-test-coverage/spec.md`](./spec.md) v3
(author-driven markdown links + cron-as-suggester). Supersedes the
v1 + v2 task lists (preserved below for history).

## v3 phases

### Phase 1 — Shared link parser

- [ ] T101 Build `agent/src/lib/spec-link-parser.ts` exporting `parseTestLinksInStatement(statement: string): Array<{ label, path, line }>`. Pure: matches `(?:\(([^)]+)\)\s*$)` then walks the inline markdown links inside that trailing parenthetical with a deterministic anchor regex (`/\[([^\]]+)\]\(([^)]+)\)/g`). Returns empty array when the statement has no trailing parenthetical or none of the contained links pass `isTestFile()`.
- [ ] T102 [P] Unit tests `agent/src/lib/__tests__/spec-link-parser.test.ts` — single link end-of-statement; multiple comma-separated links in one paren; trailing paren containing both a test link and a non-test link (e.g. ADR ref); trailing paren containing only a non-test link (returns empty); link with no `#Lline` anchor (parses `line: null`); statement with no trailing paren (returns empty).
- [ ] T103 Re-export `parseTestLinksInStatement` from `@re-cinq/lore-shared` so the web-ui can import it too without duplicating the regex (move to `shared/src/spec-link-parser.ts` if cleaner; agent imports back from shared).

### Phase 2 — Web UI rewires to markdown-driven coverage

- [ ] T104 Rewrite the rehype highlighter in `web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.tsx`. New rule: walk HAST `element` nodes, when an `<a>` element's `href` path passes `isTestFile()` AND the link sits inside the trailing-paren region of a statement, wrap that statement (and the link itself) in `<mark class="stmt stmt-tested">` with `data-state="tested"`. Statements with no test link inside their trailing paren classify via `classifyByHeuristic` (testable → `stmt-untested`, untestable → `stmt-narrative`). Other links render unchanged.
- [ ] T105 [P] Tests `web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx` — green wrap for plain test link; grey for narrative-section statement; red for testable + no link; ADR link in trailing paren does not green-wrap; multiple test links in one paren all wrap; legacy DB-driven props removed from the prop type.
- [ ] T106 Modify `web-ui/src/app/repos/[owner]/[repo]/specs/page.tsx` — drop the `spec_statements`, `spec_test_links`, `spec_coverage_runs` queries. Read spec chunks only. Compute the `coverage: {testable, covered, untestable}` counts on the server by segmenting + classifying + counting trailing test-links per statement; pass the derived counts into `SpecCard`. The Add Spec form is preserved unchanged (AC13 of v2 carries).
- [ ] T107 Modify `web-ui/src/app/repos/[owner]/[repo]/specs/[...path]/page.tsx` — same: drop the per-statement / per-link DB queries; pass chunks (and the derived counts) into `SpecDetails`.
- [ ] T108 [P] Update `SpecCard.tsx` — drop the `last_linked_at` / `last_linked_by` subline (no DB attribution in v3); the props now accept only the derived `coverage` counts. The CoverageBar component itself doesn't change.
- [ ] T109 [P] Update `mcp-server/src/routes.ts` `composeSpecCoverage` — either delete entirely (UI no longer calls `GET /spec-coverage`) or repoint to derive counts from markdown. Decide based on whether any external consumer reads the JSON payload; if not, delete.

### Phase 3 — Cron validate pass (post-ingest, link rot)

- [ ] T110 Build `agent/src/jobs/scheduled/spec-coverage-validate.ts` exporting `validateSpecCoverageJob(opts: { repoFilter?: string }): Promise<string>`. Per repo, per spec chunk: reassemble + segment + for each statement's parsed test links, resolve `path#Lline` against `{schema}.chunks` (content_type='code', `metadata.start_line` ≤ line ≤ `metadata.end_line`). When a link doesn't resolve, accumulate into a broken-links report.
- [ ] T111 [P] Tests `agent/src/jobs/scheduled/__tests__/spec-coverage-validate.test.ts` — fixture: link resolves to a known chunk line range → no flag; link resolves to a file but no chunk covers the line → flag `line-out-of-range`; file in href doesn't exist as any chunk → flag `file-missing`; link href doesn't pass `isTestFile()` → ignored (not in scope for validate).
- [ ] T112 PR-comment emitter: when the broken-links report is non-empty, find the most recent open PR for the spec's repo that touches `specs/`; post a comment listing the broken links with `file:line` references. Fall back: when no such PR exists, open an issue labelled `spec-link-rot` summarizing the broken links.
- [ ] T113 Rename `POST /api/trigger/spec-test-linker` → `POST /api/trigger/spec-coverage-validate` in `agent/src/health.ts`. Body unchanged (`{ repo, linked_by? }` — drop the `linked_by` field, no longer relevant). Returns 202; runs `validateSpecCoverageJob({ repoFilter: repo })` in background.
- [ ] T114 Update `mcp-server/src/routes.ts` `handleIngest` fan-out: rename `triggerAgentSpecTestLinker` → `triggerAgentSpecCoverageValidate`, point at the new agent endpoint. Update the 5 trigger forwarder tests to match.

### Phase 4 — Cron backfill pass (weekly, suggest links via PRs)

- [ ] T115 Rename `agent/src/jobs/cron/spec-test-linker.ts` → `agent/src/jobs/cron/spec-coverage-backfill.ts`. Reuses the segment + classify (heuristic + LLM-fallback) + selectCandidates + judgeLink + argmaxByTest pipeline verbatim. Removes: `persistStatements`, `persistLinks`, `recordContentHash`, `getLastContentHash`, the `linked_by` param. Replaces the persist step with a `proposeLinkInsertions` step.
- [ ] T116 Build `proposeLinkInsertions(spec_path, content, suggestions): { newContent, diffPreview }`. Pure: for each (statement_ordinal, test_file, test_line, label) suggestion, locate the statement in `content` by ordinal + exact-text match, append the inline parenthetical `\n   ([validated by \`{label}\`](path#L{line}))` at the end of the statement (preserving the surrounding markdown). Returns the rewritten content and a unified-diff preview for the PR body.
- [ ] T117 [P] Unit tests for `proposeLinkInsertions` — single statement / single suggestion produces the expected paren; statement that already has one link gets a second comma-separated link in the same paren; statement that already has a test link for the suggested target gets NO duplicate; multi-line statement inserts at end of the last line; suggestion whose ordinal no longer matches a statement (drift case) is skipped with a warning.
- [ ] T118 PR opener: for each spec with ≥1 suggestion, the cron clones the spec's repo (reuses the agent's `CodePlatform` interface from `agent/src/platform.ts`), writes the new content, opens a PR titled `"Suggested test links for {spec_path}"` with the diff preview in the body. Uses the existing `gh` / Octokit client (same as the local task runner does).
- [ ] T119 Register `spec_coverage_backfill` in `agent/src/job-runner.ts` dispatch; remove the `spec_test_linker` entry.
- [ ] T120 Update `terraform/modules/gke-mcp/agent-helm/values.yaml` — rename the cron entry `spec-test-linker` → `spec-coverage-backfill` (same Mon 11:00 UTC schedule). Add a daily `spec-coverage-validate` cron entry as a sweep-mode fallback in case the post-ingest trigger missed an event.

### Phase 5 — v2 cleanup (delete persistence apparatus)

- [ ] T121 Delete `mcp-server/src/spec-coverage-prepare.ts`, `spec-coverage-persist.ts`, `spec-coverage-stale.ts` and their `__tests__` files. Remove the route handlers `handleSpecCoverage`, `handleSpecCoverageStale`, `handleSpecCoveragePrepare`, `handleSpecCoveragePersist` from `routes.ts`. Remove the corresponding URL-matcher branches and `SCOPE_OVERRIDES` entry for `/spec-coverage/persist`. Remove `CoverageRunSummary` and `composeSpecCoverage` if no consumer remains.
- [ ] T122 Delete the three v2 MCP tools (`prepare_spec_link`, `persist_spec_link`, `list_stale_spec_coverage`) from `mcp-server/src/index.ts`.
- [ ] T123 Delete `.claude/skills/lore-link-coverage/` and the directory.
- [ ] T124 Delete (or rewrite as v3 equivalents) the v2 tests: `mcp-server/src/__tests__/spec-coverage.test.ts`, `spec-coverage-prepare.test.ts`, `spec-coverage-persist.test.ts`, `spec-coverage-stale.test.ts`, `spec-test-linker-trigger.test.ts`. The trigger test rewrites to target the renamed validate endpoint.
- [ ] T125 [P] Add migration `terraform/modules/gke-mcp/ui-helm/migrations/NNNN_drop_v2_spec_coverage_tables.sql` — per-team-schema `DROP TABLE IF EXISTS spec_test_links, spec_statements, spec_coverage_runs CASCADE`. Same `pg_catalog`-discovery pattern as 0002/0004/0005/0006/0007. Idempotent.
- [ ] T126 [P] Update `CLAUDE.md` — rewrite the spec-test-coverage / dark-factory / local-coverage-linker paragraphs to describe v3; remove the `prepare_spec_link` / `persist_spec_link` / `list_stale_spec_coverage` MCP-tool callouts; mention the new validate + backfill cron pair.

### Phase 6 — Verify

- [ ] T127 Typecheck clean across `shared/`, `agent/`, `mcp-server/`, `web-ui/`; full test suites green. Expected delta: ~-50 tests deleted (v2 persist/prepare/stale/trigger) + ~+25 tests added (link parser, validate, backfill `proposeLinkInsertions`, UI rehype).
- [ ] T128 Manual end-to-end with one real repo:
  - Author commits a spec with a markdown test link → ingest → UI page shows green wrap and the CoverageBar percentage updates.
  - Delete the test file referenced by the link → re-ingest → validate cron posts a PR comment listing the broken link.
  - On a spec with un-linked testable statements → manually run the backfill cron → confirm a PR opens with `([validated by ...](...))` insertions, the inserted content lints clean, and merging the PR turns the affected statements green in the UI.
- [ ] T129 [P] Confirm there are zero remaining writes to `spec_statements`, `spec_test_links`, `spec_coverage_runs` in the codebase (`grep -r` should return only the drop migration). Once confirmed, run T125's migration in prod.

### Phase 7 — Follow-ups (deferred, not in v3)

- [ ] F-validate-fallback Open a `spec-link-rot` labelled issue when no open PR exists for the spec's repo (covers limitation 4).
- [ ] F-coverage-integration Wire `specs/coverage-ingestion/` execution-trace data into the backfill judge's selectCandidates pre-filter (covers limitation 9).
- [ ] F-suggestion-throttle Rate-limit the first backfill run so the burst of suggestion-PRs is staggered (covers limitation 1).
- [ ] F-ci-link-check Standalone CI workflow that runs the validate pass on every PR touching `specs/` so authors see broken links as a check, not after merge (parallel path to the cron).
- [ ] F-format-tolerance Extend `parseTestLinksInStatement` to accept additional formats (mid-statement links, footnote-style refs) for authors who already write specs that way.

---

## History

### v1 — original linker (shipped, then superseded)

The original `feat/spec-test-coverage` PR (#476) shipped a flat
test-count line per spec. v1 had no statement-level coloring, no
LLM judge, no MCP tools.

### v2 — statement-level linker + CoverageBar (shipped, scheduled for removal)

Phases 6–14 below shipped the v2 statement-level redesign: deterministic
segmentation, section-heuristic classifier, LLM judge, `argmaxByTest`
dedup, `spec_statements` + `spec_test_links` + `spec_coverage_runs`
persistence, `CoverageBar` UI, statement highlighting via rehype
plugin keying off DB ordinals. All shipped on main (commits
`a8d0ba1`…`0e35bb6`).

v3 cleanup deletes the persistence + MCP-tool + skill apparatus
(Phase 5) but keeps the UI components, the shared segmenter +
classifier + judge helpers, and the cron pipeline structure
(repurposed). The v2 tests for the kept components stay green; the
tests for the deleted apparatus are removed in T124.

The v2 task list (T001–T046) is below for archaeology. T019 (manual
walkthrough) was deferred under v2 and is now superseded by T128.

#### v2 — Phase 1 — Data layer

- [x] T001 Add migration `terraform/modules/gke-mcp/ui-helm/migrations/NNNN_spec_test_links.sql` creating `{schema}.spec_test_links` + indexes per team schema, idempotent (`IF NOT EXISTS`), tracked in `lore.schema_migrations`
- [x] T002 [P] Add `isTestFile(filePath)` path heuristics (`.test.`, `.spec.`, `_test.`, `__tests__/`, `*_test.go`) in `agent/src/lib/test-paths.ts`
- [x] T003 [P] Add `normalizeTestName(describe, it)` (lowercase, collapse whitespace, ` › ` join) in `agent/src/lib/test-paths.ts`
- [x] T004 [P] Unit tests for `test-paths.ts` in `agent/src/lib/test-paths.test.ts` (positive/negative path cases, name normalization)

#### v2 — Phase 2 — Linker job

- [x] T005 Add candidate-selection pure function `selectCandidates(spec, assertions, codeChunks)` (assertion overlap + directory affinity + embedding proximity, capped at `MAX_CANDIDATES_PER_SPEC`, returns truncation flag) in `agent/src/jobs/spec-test-linker.ts`
- [x] T006 Add `judgeLink(spec, testChunk)` LLM call returning `{ matches, rationale }` via `callLLMWithTool` (reuse `spec_drift`/new `spec_test_linker` jobName for cache), in `agent/src/jobs/spec-test-linker.ts`
- [x] T007 Add upsert + stale-prune persistence (`ON CONFLICT ... DO UPDATE`, prune keys no longer confirmed this run) in `agent/src/jobs/spec-test-linker.ts`
- [x] T008 Wire `specTestLinkerJob()` orchestration: reuse `extractAssertions` + activity pre-filter (mirror `spec-drift.ts`), `isAssertionSource` gate, per-repo loop, candidate cap truncation logging
- [x] T009 [P] Unit tests `agent/src/jobs/spec-test-linker.test.ts` (candidate selection, cap+truncation log, stale-prune logic) — pure functions only, no live LLM
- [x] T010 Register `specTestLinkerJob` on a weekly schedule in `agent/src/index.ts`

#### v2 — Phase 3 — API

- [x] T011 Add `GET /api/repos/:owner/:repo/spec-coverage` handler in `mcp-server/src/routes.ts`: resolve schema, join `spec_test_links` ⨝ spec chunks, reassemble title/summary, compose source URLs, return payload (read scope, bearer auth)
- [x] T012 [P] Add pure `parseSpecTitle()` + `extractSummary()` + `reassembleSpec()` — canonical in `shared/src/spec-summary.ts` (used by API), mirrored in `web-ui/src/lib/spec-summary.ts` (used by page); unit tests both sides

#### v2 — Phase 4 — Web UI

- [x] T013 [P] Build `SpecCard.tsx` (title, file_path, summary, coverage line, Details button; zero-test gap state) in `web-ui/src/app/repos/[owner]/[repo]/specs/`
- [x] T014 [P] Build `SpecDetails.tsx` client component: `react-markdown` + `remark-gfm` + `rehype-raw` full-spec render (reassembled chunks) + matched test list with source links + expandable rationale
- [x] T015 Details surface = **route** `/repos/:o/:r/specs/[...path]` (catch-all, `encodeURIComponent` contract per web-ui CLAUDE.md); navigation wired from `SpecCard`
- [x] T016 Rewrite `web-ui/src/app/repos/[owner]/[repo]/specs/page.tsx`: DB-direct coverage (spec chunks + link counts) → `SpecCard` list, **Add Spec form preserved unchanged**
- [x] T017 [P] Styling reuses existing `spec-card` / `content-viewer` / `btn-secondary` classes + inline styles (no new CSS file needed)

#### v2 — Phase 5 — Verify (v1)

- [x] T018 Typecheck (shared/agent/mcp-server/web-ui all clean) + test suites green: shared 76, agent 368, web-ui 112. AC 1–10 satisfied by implementation.

> **v1 → v2 transition.** Commit `87c7872` rewrote `spec.md` + `data-model.md` to add **statement-level** coverage (segmentation, classification, `CoverageBar`, hash-gate freshness, rehype highlighter) — **none of which were implemented**. v1 (whole-spec linking, flat test list) shipped in `ed947d4`. Phases 6–14 below close the v2 gap; T019 is deferred until v2 lands.

#### v2 — Phase 6 — v2 data migrations

- [x] T020 [P] Add migration `terraform/modules/gke-mcp/ui-helm/migrations/0004_spec_statements.sql` creating `{schema}.spec_statements` per team schema (idempotent, `UNIQUE (repo, spec_path, ordinal)`, `spec_statements_spec_idx`)
- [x] T021 [P] Add migration `terraform/modules/gke-mcp/ui-helm/migrations/0005_spec_coverage_runs.sql` creating `{schema}.spec_coverage_runs` (PK `(repo, spec_path)`, `content_hash`, `run_at`)
- [x] T022 [P] Add migration `terraform/modules/gke-mcp/ui-helm/migrations/0006_spec_test_links_statement_cols.sql` additive `ALTER TABLE {schema}.spec_test_links ADD COLUMN IF NOT EXISTS statement_ordinal INTEGER, statement_text TEXT, match_score REAL` + `spec_test_links_stmt_idx (repo, spec_path, statement_ordinal)`

#### v2 — Phase 7 — Statement segmentation (shared, pure)

- [x] T023 Create `shared/src/spec-segment.ts` exporting `segmentStatements(content)` — deterministic sentence + list-item splitter (`.?!` w/ abbreviation guard; each list item a statement; headings/fenced code/tables excluded; tracks enclosing heading). **Deviation:** spec.md File Changes lists `agent/src/lib/spec-segment.ts`; placed in `shared/` to follow T012's canonical-in-shared pattern so agent + web-ui + mcp-server all import from `@re-cinq/lore-shared`.
- [x] T024 [P] Unit tests `shared/src/__tests__/spec-segment.test.ts` (abbreviation guard, list items, headings/code/tables excluded, ordinal determinism across re-runs) — 20 passing
- [x] T025 Re-export `segmentStatements` (and the classifier helpers from T026) from `shared/src/index.ts`; verify agent + web-ui resolve them

#### v2 — Phase 8 — Statement classifier

- [x] T026 Add `classifyByHeuristic(statement, enclosingHeading)` to `shared/src/spec-segment.ts` — section heuristic (Problem Statement / Vision / Background / Clarifications / Open Questions / Limitations / Rationale + H1/intro → `untestable` w/ category). Errs toward `testable` on ambiguity (false-red is visible, false-grey hides gaps).
- [x] T027 Add `classifyLLM(unclassified[])` to `agent/src/jobs/cron/spec-test-linker.ts` — batched one-shot LLM fallback for statements the heuristic doesn't catch, via `callLLMWithTool` with the existing `spec_test_linker` jobName for cache reuse
- [x] T028 [P] Tests for classifier — heuristic matches return correct category, ambiguous default `testable` (covered in shared spec-segment.test.ts § classifyByHeuristic, 8 cases)

#### v2 — Phase 9 — Linker refactor (statement-level + hash gate)

- [x] T029 Content-hash freshness gate in `agent/src/jobs/cron/spec-test-linker.ts`: read `spec_coverage_runs.content_hash`, hash `reassembleSpec()` output, skip spec on unchanged hash, write hash on successful run
- [x] T030 Refactor `judgeLink()` to accept the spec's enumerated testable statements and return `{ matches, statement_ordinal, score, rationale }`
- [x] T031 Add `argmaxByTest()` best-match dedup — per `(test_file, test_name)` keep only the row with highest `match_score`; drop rows below `τ_score` (0.5)
- [x] T032 Persist statements: upsert `spec_statements` rows; prune ordinals no longer present this run (matching `staleLinkKeys` pattern)
- [x] T033 Extend `persistLinks()` to write `statement_ordinal`, `statement_text`, `match_score` columns
- [x] T034 [P] Tests for hash gate, judge return shape, argmax dedup, statement upsert+prune, link statement-column writes — hashSpecContent (3), staleStatementOrdinals (3), argmaxByTest (4); 32 tests passing

#### v2 — Phase 10 — API payload extension

- [x] T035 Extend `GET /api/repos/:owner/:repo/spec-coverage` in `mcp-server/src/routes.ts`: query `spec_statements` for the full statements array; compute `coverage.{testable, covered, untestable}`; include per-test `statement_ordinal` + `match_score`; payload shape per `data-model.md` §Coverage API payload. Extracted `composeSpecCoverage()` as pure helper for testability.
- [x] T036 [P] Tests for the new payload shape — `mcp-server/src/__tests__/spec-coverage.test.ts`, 6 tests covering coverage math, statement passthrough, per-test ordinal/score, legacy null-ordinal degradation, empty-statements fallback

#### v2 — Phase 11 — CoverageBar component

- [x] T037 Build `web-ui/src/components/CoverageBar.tsx` — stacked three-segment bar (`tested / untested / fluff`), widths over **all** statements, caption `tested / (tested + untested)`, theme tokens `--success` / `--danger` / `--text-muted`, non-colour cues (label/icon per segment), muted-empty state when zero testable
- [x] T038 [P] Tests for `CoverageBar` (width math, empty state, caption formula, non-colour cue present per segment) — 7 passing

#### v2 — Phase 12 — SpecCard + per-repo specs page

- [x] T039 Update `web-ui/src/app/repos/[owner]/[repo]/specs/SpecCard.tsx` to replace inline test-count with `<CoverageBar>` + caption (mockup at spec.md §Card list)
- [x] T040 Update `web-ui/src/app/repos/[owner]/[repo]/specs/page.tsx` to fetch the extended coverage payload; **Add Spec form preserved unchanged** (AC13)

#### v2 — Phase 13 — SpecDetails statement highlighting

- [x] T041 Rehype highlight plugin in `web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.tsx` (manual hast walker, not visit — visit mutation under-foot caused index drift) that wraps each statement's longest contiguous text run in `<mark class="stmt stmt-{tested|untested|narrative}">`
- [x] T042 Hover popovers (lightweight onMouseOver delegation, no HelpPopover dependency): tested → validating test names + source links + rationales; untested → "no test yet" hint; narrative → category
- [x] T043 Add `<CoverageBar>` to the details header (size="md")
- [x] T044 Flag list-only links (un-anchored) and legacy null-ordinal rows in the retained test list (AC12)
- [x] T045 [P] Tests for the rehype plugin (full-statement contiguous wrap, formatting-mixed statement falls back without throwing, legacy flag, list-only flag) — 6 passing

#### v2 — Phase 14 — Verify (v2)

- [x] T046 Typecheck + test suites green across all packages — shared 116, agent 400, mcp-server 204, web-ui 139 (859 tests total)
- [ ] T019 Manual UI walkthrough — needs a logged-in human. **Smoke-tested non-interactively:** (a) `npx next build` compiles every route including `/repos/[owner]/[repo]/specs` (860 B) and `/repos/[owner]/[repo]/specs/[...path]` (2.76 kB w/ rehype client bundle); (b) migrations 0004/0005/0006 applied cleanly to a real local Postgres against a pre-existing team schema; (c) seed inserts of `chunks` + `spec_statements` + `spec_test_links` rows persisted under the v2 schema's constraints + indexes (CONFLICT-on-upsert path verified). The hover popover UX still needs eyes-on browser verification once a signed-in user (`/api/auth/signin`) can hit `/repos/{owner}/{repo}/specs`. **Superseded by T128.**
