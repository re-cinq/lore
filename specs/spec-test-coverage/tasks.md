# Tasks: Spec → Test Coverage

## Phase 1 — Data layer

- [ ] T001 Add migration `terraform/modules/gke-mcp/ui-helm/migrations/NNNN_spec_test_links.sql` creating `{schema}.spec_test_links` + indexes per team schema, idempotent (`IF NOT EXISTS`), tracked in `lore.schema_migrations`
- [ ] T002 [P] Add `isTestFile(filePath)` path heuristics (`.test.`, `.spec.`, `_test.`, `__tests__/`, `*_test.go`) in `agent/src/lib/test-paths.ts`
- [ ] T003 [P] Add `normalizeTestName(describe, it)` (lowercase, collapse whitespace, ` › ` join) in `agent/src/lib/test-paths.ts`
- [ ] T004 [P] Unit tests for `test-paths.ts` in `agent/src/lib/test-paths.test.ts` (positive/negative path cases, name normalization)

## Phase 2 — Linker job

- [ ] T005 Add candidate-selection pure function `selectCandidates(spec, assertions, codeChunks)` (assertion overlap + directory affinity + embedding proximity, capped at `MAX_CANDIDATES_PER_SPEC`, returns truncation flag) in `agent/src/jobs/spec-test-linker.ts`
- [ ] T006 Add `judgeLink(spec, testChunk)` LLM call returning `{ matches, rationale }` via `callLLMWithTool` (reuse `spec_drift`/new `spec_test_linker` jobName for cache), in `agent/src/jobs/spec-test-linker.ts`
- [ ] T007 Add upsert + stale-prune persistence (`ON CONFLICT ... DO UPDATE`, delete rows older than run start per spec) in `agent/src/jobs/spec-test-linker.ts`
- [ ] T008 Wire `specTestLinkerJob()` orchestration: reuse `extractAssertions` + activity pre-filter (mirror `spec-drift.ts`), `isAssertionSource` gate, per-repo loop, candidate cap truncation logging
- [ ] T009 [P] Unit tests `agent/src/jobs/spec-test-linker.test.ts` (candidate selection, cap+truncation log, stale-prune logic) — pure functions only, no live LLM
- [ ] T010 Register `specTestLinkerJob` on a weekly schedule in `agent/src/index.ts`

## Phase 3 — API

- [ ] T011 Add `GET /api/repos/:owner/:repo/spec-coverage` handler in `mcp-server/src/routes.ts`: resolve schema, join `spec_test_links` ⨝ spec chunks, reassemble title/summary, compose source URLs, return payload (read scope, bearer auth)
- [ ] T012 [P] Add pure `parseSpecTitle()` + `extractSummary()` in `web-ui/src/lib/spec-summary.ts` (shared by API/page) with unit tests in `spec-summary.test.ts`

## Phase 4 — Web UI

- [ ] T013 [P] Build `SpecCard.tsx` (title, file_path, summary, coverage line, Details button; zero-test gap state) in `web-ui/src/app/repos/[owner]/[repo]/specs/`
- [ ] T014 [P] Build `SpecDetails.tsx` client component: `react-markdown` + `remark-gfm` + `rehype-raw` full-spec render (reassembled chunks) + matched test list with source links + expandable rationale
- [ ] T015 Decide Details surface (route `/repos/:o/:r/specs/[...path]` vs modal — recommend route) and wire navigation from `SpecCard`
- [ ] T016 Rewrite `web-ui/src/app/repos/[owner]/[repo]/specs/page.tsx`: fetch coverage payload, render `SpecCard` list, **preserve the existing Add Spec form unchanged**
- [ ] T017 [P] Add `Linkified`/`react-markdown`-consistent styling for cards + details (reuse `spec-card` / `ReadmeBox` CSS patterns)

## Phase 5 — Verify

- [ ] T018 Run `agent` + `web-ui` test suites (`check-tests` / `pre-push`) and typecheck; confirm all acceptance criteria 1–10
- [ ] T019 Manual: load `/repos/re-cinq/lore/specs`, confirm cards, summaries, coverage counts, Details markdown render, and working source links against a real linked spec
