# Tasks: Coverage Ingestion

> **⚠️ Deferred — see [`spec-test-coverage` v3](../spec-test-coverage/spec.md).** v2 + `local-coverage-linker` are being torn down in v3 Phase 5; the original "feeds v2 candidate pre-filter" framing no longer applies. The migrations, parsers, endpoint, and storage tables in this spec all stand; only the **consumer** changes. If picked up later, the consumer becomes `agent/src/jobs/cron/spec-coverage-backfill.ts` (v3 file) — its `selectCandidates` gains a new `coverage` match_kind (rank 4) over the v3 backfill's existing assertion/directory/embedding signals.

Implements [`specs/coverage-ingestion/spec.md`](./spec.md). Benefits
[`spec-test-coverage`](../spec-test-coverage/spec.md) v3 backfill cron
(when picked up). **No scheduled implementation date.**

## Phase 1 — Data

- [ ] T001 [P] Add migration `terraform/modules/gke-mcp/ui-helm/migrations/NNNN_coverage_lines.sql` — per-team-schema `coverage_lines` table + 3 indexes (`coverage_lines_test_idx`, `coverage_lines_file_idx`, `coverage_lines_commit_idx`), idempotent, same `pg_catalog`-discovery + `GRANT` pattern as the spec-coverage migrations. Use the next available migration number.
- [ ] T002 [P] Add migration `terraform/modules/gke-mcp/ui-helm/migrations/NNNN_coverage_runs.sql` — per-team-schema `coverage_runs` table (`PRIMARY KEY (repo, commit_sha)`)
- [ ] T003 [P] Add a small CHECK constraint or trigger that rejects rows where `line_end < line_start` (catches malformed uploads early)

## Phase 2 — Parsers (pure, no DB)

- [ ] T004 Build `mcp-server/src/coverage/lcov.ts` exporting `parseLcov(payload: string): NormalizedCoverage[]`. Handles `TN:` (test name) / `SF:` (source file) / `DA:line,hits` / `BRDA:` (ignored) / `end_of_record`. When no `TN:` precedes a `SF:` block, emit rows with `test_name = '*'` (per-file aggregate). Collapses contiguous covered lines into ranges (`line_start`..`line_end`). Strips `node_modules/` / `vendor/` / `dist/` / `build/` paths.
- [ ] T005 Build `mcp-server/src/coverage/cobertura.ts` exporting `parseCobertura(payload: string): NormalizedCoverage[]` — XML parser via the existing parser dependency or `fast-xml-parser`; walks `<class filename>` → `<lines>` → `<line number hits>`. Per-test attribution only when the `test` attribute is present (some Cobertura emitters do); otherwise `test_name = '*'`.
- [ ] T006 [P] Unit tests `mcp-server/src/__tests__/coverage-lcov.test.ts` — `TN:` blocks attribute correctly; missing `TN:` block produces `'*'` rows; multiple `DA:` lines collapse to a single contiguous range; non-contiguous `DA:` produces two ranges; `end_of_record` resets state; `node_modules/` paths filtered
- [ ] T007 [P] Unit tests `mcp-server/src/__tests__/coverage-cobertura.test.ts` — fixture-based; covers absent `test` attribute, multiple classes per file, lines with `hits=0` (still emitted with `hit_count=0` so the linker can tell "covered by the build but never hit")

## Phase 3 — Persistence + endpoint

- [ ] T008 Build `mcp-server/src/coverage-ingest.ts` exporting `ingestCoverage(pool, repo, body)`. Pipeline: pick parser by `body.format` → normalize → resolve schema → delete previous rows for `(repo, commit_sha)` → bulk insert into `coverage_lines` (chunked at ~5K rows per `INSERT`) → upsert `coverage_runs` → return counts.
- [ ] T009 Add `POST /api/repos/:owner/:repo/coverage` handler to `mcp-server/src/routes.ts` — write scope, bearer auth, body validation via Zod (`format` enum, `commit` non-empty, `payload` ≤ 25 MB), calls `ingestCoverage`. Fires `triggerAgentSpecTestLinker(repo)` fire-and-forget after the 200 response (mirrors how `handleIngest` does it).
- [ ] T010 Add `GET /api/repos/:owner/:repo/coverage/status` handler to `mcp-server/src/routes.ts` — read scope, joins `coverage_runs` + `coverage_lines` for `tests_anonymous_pct`, returns 404 when no runs exist
- [ ] T011 [P] Tests `mcp-server/src/__tests__/coverage-ingest.test.ts` — round-trip an LCOV payload, assert rows; re-upload the same `(repo, commit_sha)` replaces prior rows; tests the 413 path on oversize payload; tests the linker-trigger fan-out (mock `fetch`)
- [ ] T012 [P] Tests `mcp-server/src/__tests__/coverage-status.test.ts` — 404 when no runs; returns latest run; `stale=true` when >7d old; `tests_anonymous_pct` math

## Phase 4 — Linker integration

- [ ] T013 Add `match_kind = "coverage"` to the union in `agent/src/jobs/cron/spec-test-linker.ts`; add to `KIND_RANK` at rank 4 (`coverage: 4, assertion: 3, directory: 2, embedding: 1`)
- [ ] T014 Extend `selectCandidates()` (or wrap it) with a pre-step: for each assertion symbol named in the spec, look up its AST symbol range in `chunks.metadata.{start_line,end_line}` (resolved via the assertion extractor's output that's already a parameter), then query `coverage_lines` for tests whose `(covered_file, line range)` overlaps; emit those as `match_kind = "coverage"` candidates **before** the existing assertion/directory/embedding pre-filter runs. Coverage candidates bypass the `MAX_CANDIDATES_PER_SPEC` cap.
- [ ] T015 [P] Tests `agent/src/jobs/cron/spec-test-linker.test.ts` — fixture with coverage rows: rank 4 wins over rank 3 when both apply; coverage candidates are returned even when assertion/directory candidates fill the cap; when `coverage_lines` is empty for the repo the function behaves byte-identically to today (regression guard)
- [ ] T016 Update `agent/src/jobs/cron/spec-test-linker.ts` candidate de-dupe to keep the highest-ranked `match_kind` per `(test_file, test_name)` — same shape as today's strongest-wins logic, just with the new rank 4 in the mix
- [ ] T017 Populate `candidate_tests[*].coverage_hits` in [`mcp-server/src/spec-coverage-prepare.ts`](../local-coverage-linker/spec.md) from the same `coverage_lines` join (was a `42P01` stub). One join, one set of rows reshaped per candidate.

## Phase 5 — Retention

- [ ] T018 Build `agent/src/jobs/cron/coverage-retention.ts` exporting `coverageRetentionJob()`. Per schema: delete `coverage_lines` + `coverage_runs` rows older than 30 days **except** the latest commit per branch (the safety-net "stale-but-most-recent" case for branches no one's pushed to lately).
- [ ] T019 Register `coverage_retention` in `agent/src/job-runner.ts` dispatch + add to `terraform/modules/gke-mcp/agent-helm/values.yaml` cron list (daily, e.g. `0 6 * * *`, after the existing memory-decay job)
- [ ] T020 [P] Tests `agent/src/jobs/cron/coverage-retention.test.ts` — rows in retention window kept; rows out of window pruned; "latest per branch" exception holds even when all rows are old

## Phase 6 — Onboard task: per-language CI templates

- [ ] T021 Add coverage-template generator to the `onboard` task (`scripts/klaus-prompts/` or wherever `onboard` lives now). Detects toolchain via `package.json` / `go.mod` / `pyproject.toml` / `Cargo.toml` / `pom.xml` / `build.gradle` and emits the matching template.
- [ ] T022 [P] `scripts/onboarding-templates/coverage/node.yml` — Vitest preferred (`vitest run --coverage --coverage.reporter=lcov`); fall back to `nyc` if `vitest` not detected; upload via `curl` to `/api/repos/:o/:r/coverage`
- [ ] T023 [P] `scripts/onboarding-templates/coverage/go.yml` — `go test -coverprofile=cover.out ./...` + `go install github.com/jandelgado/gcov2lcov@latest && gcov2lcov < cover.out > lcov.info`; upload
- [ ] T024 [P] `scripts/onboarding-templates/coverage/python.yml` — `coverage run -m pytest && coverage lcov -o lcov.info`; upload
- [ ] T025 [P] `scripts/onboarding-templates/coverage/rust.yml` — `cargo install cargo-tarpaulin && cargo tarpaulin --out Lcov --output-dir .`; upload
- [ ] T026 [P] `scripts/onboarding-templates/coverage/java.yml` — JaCoCo Cobertura output (`mvn jacoco:report -Pcobertura` or Gradle equivalent); upload with `format=cobertura`
- [ ] T027 Update the `onboard` task's PR-body footer to mention what coverage tooling was wired and how to disable it (single env var the workflow checks)

## Phase 7 — UI surface

- [ ] T028 [P] Update `web-ui/src/app/repos/[owner]/[repo]/specs/page.tsx` to fetch `/coverage/status` server-side; pass `status` into the page chrome
- [ ] T029 [P] Build `web-ui/src/components/CoveragePill.tsx` — small pill ("coverage: live" / "coverage: absent" / "coverage: stale"), hover popover showing last commit + run_at + `tests_anonymous_pct`
- [ ] T030 [P] Unit tests for `CoveragePill` — three states render distinctly; hover reveals popover; absent state links to docs
- [ ] T031 [P] Optional: also surface the pill on the global `/specs` viewer (cross-repo) — out-of-scope marker if punted

## Phase 8 — Docs + CLAUDE.md

- [ ] T032 Update repo `CLAUDE.md` with a short paragraph on coverage-aware matching (under the spec-test-coverage section) and the CI workflow contract
- [ ] T033 [P] Add a runbook `runbooks/coverage-ingestion.md` covering: how to verify a repo's coverage is uploading; how to debug a "tests_anonymous_pct: 100%" repo; how to add a language template not in the auto-onboarder set; how to read the linker's coverage-aware candidate logs

## Phase 9 — Verify

- [ ] T034 Typecheck + tests green across `shared/`, `agent/`, `mcp-server/`, `web-ui/`; full suite estimated +50 tests added by phases 2–7
- [ ] T035 End-to-end with one real repo: merge the onboarding PR; let CI run and upload; manually trigger the linker for one spec; verify the judge's rationales reference covered files (e.g. "covers `runner.ts:42-58` (`claimNextTask`)"); confirm `match_kind = "coverage"` rows appear in `spec_test_links`
- [ ] T036 [P] Performance budget check — a single LCOV upload for a 50K-LOC repo (~30K coverage rows) completes within 8 s wall clock (parse + insert dominated; tune chunk size if exceeded)
- [ ] T037 [P] Storage projection check — after 4 weeks of real ingestion, query `pg_relation_size('platform.coverage_lines')`; if >2 GB per repo, tune the retention window in T018

## Phase 10 — Follow-ups (deferred, not in v1)

- [ ] F001 Coverage-hash bust on the linker's freshness gate — extend the spec content hash to also incorporate the latest coverage `commit_sha`, so a coverage upload without a spec edit still triggers re-judging (covers spec.md limitation 6)
- [ ] F002 Per-repo `coverage_exclude_paths` setting for generated code (proto stubs, codegen) so they don't pollute the rows (covers limitation 8)
- [ ] F003 `path_prefix_strip` field on `POST /coverage` for monorepos whose test runner uses an off-root CWD (covers limitation 3)
- [ ] F004 `coverage-results` follow-up spec: ingest test pass/fail status alongside coverage; UI shows green/red per linked test (covers limitation 5)
- [ ] F005 Signed coverage uploads (HMAC over `commit_sha + payload`) — defense in depth against CI compromise (covers limitation 7)
- [ ] F006 Templates for the long-tail languages (.NET / Ruby / PHP / Swift / C++) the auto-onboarder doesn't cover (covers limitation 2 tail)
- [ ] F007 A per-repo "coverage ratchet" — record the `covered/testable` ratio per spec per commit, surface trend in the UI, warn on regressions (covers a UX gap, not a spec limitation)
