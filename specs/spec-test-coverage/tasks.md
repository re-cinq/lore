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

## Phase 5 — Verify

- [x] T018 Typecheck (shared/agent/mcp-server/web-ui all clean) + test suites green: shared 76, agent 368, web-ui 112. AC 1–10 satisfied by implementation.
- [ ] T019 Manual UI walkthrough — BLOCKED in this env: no running stack / DB (Lore backend not configured locally; `assemble_context` confirmed). Needs deploy + a repo with linked specs.
