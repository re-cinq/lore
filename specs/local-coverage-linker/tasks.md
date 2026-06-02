# Tasks: Local Coverage Linker (BYO-Compute)

> **⚠️ Superseded by [`spec-test-coverage` v3 tasks](../spec-test-coverage/tasks.md).** The implementation below shipped in PR #484 (commit `cea9c55`) and is scheduled for deletion in v3 Phase 5 (T121–T125). No further work happens against this task list. Tracked deletion items live in the v3 file; everything below is left checked-off for archaeology.

Implements [`specs/local-coverage-linker/spec.md`](./spec.md). Depends on
[`specs/spec-test-coverage/spec.md`](../spec-test-coverage/spec.md)
(v2 statement-level linker — must be merged first).

## Phase 1 — Data attribution

- [x] T001 Add migration `terraform/modules/gke-mcp/ui-helm/migrations/0007_spec_coverage_runs_linked_by.sql` — additive `ALTER TABLE {schema}.spec_coverage_runs ADD COLUMN IF NOT EXISTS linked_by TEXT` per team schema, idempotent, same `pg_catalog`-discovery + `GRANT` pattern as 0006
- [x] T002 [P] Update `recordContentHash()` in `agent/src/jobs/cron/spec-test-linker.ts` to accept + write a `linkedBy` parameter (defaults to `'cron'`)
- [x] T003 [P] Update `agent/src/health.ts` `POST /api/trigger/spec-test-linker` to read optional `linked_by` from the body (defaults `'webhook'`), pass through `specTestLinkerJob({repoFilter, linkedBy})`
- [x] T004 [P] Tests: `recordContentHash` writes `linked_by`; cron path defaults `'cron'`; webhook path defaults `'webhook'`

## Phase 2 — Prepare composer (pure, server-side)

- [x] T005 Build `mcp-server/src/spec-coverage-prepare.ts` exporting `prepareSpecCoverage(pool, repo, specPath)`. Pure composition over: `reassembleSpec` → `segmentStatements` → `buildIntroOrdinals` → `classifyByHeuristic` (per statement) → `selectCandidates` → `hashSpecContent`. Returns the API payload from spec.md §API/prepare. Loads `assertion_hints` opportunistically from a small cache table or returns `null` if absent. **Coverage hits:** populates `candidate_tests[*].coverage_hits` from a `{schema}.coverage_lines` table when it exists (delivered by the future `coverage-ingestion` spec) via a try/catch on `42P01` "relation does not exist" — empty array when no coverage data, graceful degradation.
- [x] T006 [P] Unit tests `mcp-server/src/__tests__/spec-coverage-prepare.test.ts` — deterministic statements across calls; correct heuristic per known section (intro / problem statement / vision / clarifications / limitations / rationale); candidate cap at 25 + truncation flag; content_hash matches `hashSpecContent(reassembled)`
- [x] T007 Add `POST /api/repos/:owner/:repo/spec-coverage/prepare` handler to `mcp-server/src/routes.ts` — read scope, bearer auth via the existing middleware, body `{ spec_path }`, calls `prepareSpecCoverage`, returns 200 + payload (404 if no spec chunks at that path)

## Phase 3 — Persist with server-side enforcement

- [x] T008 Build `mcp-server/src/spec-coverage-persist.ts` exporting `persistSpecCoverage(pool, repo, specPath, body)`. Pipeline: hash-mismatch check (→ 409), ordinal-membership check (→ 400), score-range check (→ 400), `argmaxByTest()` dedup + τ threshold (reuse `@re-cinq/lore-agent` exports or move to `@re-cinq/lore-shared` if needed), then upsert `spec_statements`, upsert `spec_test_links`, `recordContentHash(linked_by)`. Returns the same `SpecCoverageEntry` the existing `GET /spec-coverage` returns.
- [x] T009 If `argmaxByTest` + `JUDGE_SCORE_THRESHOLD` are not yet exportable to mcp-server, extract them to `shared/src/spec-judge.ts` and re-export from `@re-cinq/lore-shared`; update agent linker import. (Skip if already shared-package-clean.)
- [x] T010 [P] Unit tests `mcp-server/src/__tests__/spec-coverage-persist.test.ts` — stale `content_hash` returns 409; unknown ordinal in classifications returns 400; unknown statement_ordinal in judgments returns 400; score below τ or above 1 returns 400; two judgments for the same `(test_file, test_name)` collapse to the higher score; `linked_by` is written from the request `agent_id` (formatted `local:{agent_id}`) or defaults to `local:unknown` when absent
- [x] T011 Add `POST /api/repos/:owner/:repo/spec-coverage/persist` handler to `mcp-server/src/routes.ts` — **write** scope, bearer auth via the existing middleware, calls `persistSpecCoverage`, surfaces the structured 400/409 errors with the body shapes in spec.md §API/persist

## Phase 4 — Stale-list endpoint

- [x] T012 Add `GET /api/repos/:owner/:repo/spec-coverage/stale` handler to `mcp-server/src/routes.ts` — read scope. SQL strategy: pull every `(spec_path, chunks)` for the repo, reassemble + hash each, join `spec_coverage_runs`; return rows where `content_hash != last_linked_hash` OR `spec_coverage_runs` has no row OR `spec_statements` has zero rows for that path
- [x] T013 [P] Unit tests `mcp-server/src/__tests__/spec-coverage-stale.test.ts` — no rows when every spec is up-to-date; returns the spec when its current hash differs from the recorded one; returns the spec when no `spec_coverage_runs` row exists; returns the spec when statements_count = 0; includes `last_linked_at` + `last_linked_by` columns from `spec_coverage_runs`

## Phase 5 — MCP tools (stdio + HTTP)

- [x] T014 Register `prepare_spec_link`, `persist_spec_link`, `list_stale_spec_coverage` MCP tools in `mcp-server/src/index.ts`. Each forwards to the matching HTTP endpoint via `LORE_API_URL` when running in stdio proxy mode (mirrors how memory tools proxy). Zod input validation per spec.md §MCP tool shape.
- [x] T015 [P] Unit tests for the Zod schemas — required fields enforced, score-range constraint, ordinal must be a non-negative integer
- [x] T016 [P] Integration test `mcp-server/src/__tests__/spec-coverage-roundtrip.test.ts` — seed a spec + code chunks, call `prepare`, simulate a classifier + judge result client-side, call `persist`, assert the DB matches the expected statements + links + `linked_by='local:test-agent'`
- [x] T017 Expose the `composeSpecCoverage` payload to include `last_linked_at` and `last_linked_by`; update `composeSpecCoverage` + the existing `spec-coverage.test.ts` to assert the new fields

## Phase 6 — Skill

- [x] T018 Build `.claude/skills/lore-link-coverage/skill.md` — the conversational flow from spec.md §UX. Handles: pick-a-spec, prepare, classify unknowns, judge candidates, persist, 409 retry (re-prepare and re-do; explain to the user that the spec changed mid-conversation), batch-loop over `list_stale_spec_coverage` output
- [x] T019 [P] Skill smoke-test transcript checked into `.claude/skills/lore-link-coverage/example.md` — frozen example showing the canonical happy path on a hand-crafted demo spec

## Phase 7 — UI attribution surface

- [x] T020 [P] Update `web-ui/src/app/repos/[owner]/[repo]/specs/page.tsx` to fetch `last_linked_at` + `last_linked_by` alongside the existing per-spec query
- [x] T021 [P] Update `web-ui/src/app/repos/[owner]/[repo]/specs/SpecCard.tsx` + `SpecCardData` to accept + render `last_linked_by` + `last_linked_at` as a subline "linked {relative-time} by {who}" only when `last_linked_by != 'cron'` (cron-linked specs render no subline)
- [x] T022 [P] Update `web-ui/src/app/repos/[owner]/[repo]/specs/[...path]/page.tsx` to include the same subline above the details `CoverageBar`
- [x] T023 [P] Unit tests `web-ui/src/app/repos/[owner]/[repo]/specs/SpecCard.test.tsx` — subline renders for `local:abc`; subline does not render for `cron`; subline shows "(local)" suffix when `linked_by` starts with `local:`

## Phase 8 — Docs + CLAUDE.md

- [x] T024 Update repo `CLAUDE.md` under the spec-coverage / task pipeline sections — add a short paragraph on BYO-compute mode, the three MCP tools, and a pointer to the skill
- [x] T025 [P] Add an entry to the MCP tool list in the assemble-context / system-prompt boilerplate so a fresh Claude session knows the tools exist

## Phase 9 — Verify

- [x] T026 Typecheck clean across `shared/`, `agent/`, `mcp-server/`, `web-ui/`; full test suites green (estimated +35 tests added in phases 2–7)
- [ ] T027 Manual end-to-end: with the GKE backend pointed at by `LORE_API_URL` and a developer-scoped `write` token configured locally, run `/lore-link-coverage re-cinq/lore` in a fresh Claude Code session against a real (or seeded) spec. Verify:
  - skill picks a stale spec
  - `prepare` returns segmented + heuristically-classified statements
  - reasoning fills in the unknown classifications + judgments
  - `persist` succeeds; the UI's `/repos/re-cinq/lore/specs` page renders the updated `CoverageBar` + the "linked by you (local)" subline
  - simulate a hash-mismatch by editing the spec mid-conversation; verify the 409 path triggers a clean re-prepare
- [ ] T028 [P] Performance check — `prepare` round-trip latency under 500 ms for a 25-statement spec, dominated by the candidate-test query; document if it exceeds and where the budget went

## Phase 10 — Follow-ups (deferred, not in v1)

- [ ] F001 Move `extractAssertions` to a fourth MCP tool / inline it in `prepare`'s response so the local Claude does that LLM call too (covers limitation 1)
- [ ] F002 `claimed_by` / `claimed_until` lease on `spec_coverage_runs` for multi-developer contention (covers limitation 2)
- [ ] F003 `persist_spec_link_batch([...])` for terminal-friendly bulk runs (covers limitation 3)
- [ ] F004 `dark_factory.linker = 'manual'` per-repo setting that disables the cron + webhook for that repo, making BYO-compute the only path (covers limitation 6)
- [ ] F005 Resolve `linked_by` `local:{agent_id}` to a real display name via a `lore.agents` join in the UI (covers limitation 5)
- [ ] F006 Draft + implement `specs/coverage-ingestion/` — server-side LCOV/Cobertura ingestion via `POST /api/repos/:o/:r/coverage`, `{schema}.coverage_lines` table, per-language CI templates. Once shipped, `prepare_spec_link.candidate_tests[*].coverage_hits` populates automatically — no client change needed — and the cron + webhook linker paths also benefit. Highest-priority follow-up: it's the lever that turns the LLM judge from a guesser into an arbiter (covers limitation 7).
