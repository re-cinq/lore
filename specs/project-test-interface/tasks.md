# Tasks: Project Test Interface

Implements [`spec.md`](./spec.md) + [`plan.md`](./plan.md), wire shapes per
[`contracts/test-commands.md`](./contracts/test-commands.md).
Strict TDD — red→green→refactor, real values, **no mocks**: tests run
against a fake project with a real declared command + real LCOV/Cobertura
fixtures, and graph units against a real local Dgraph. `[P]` =
parallelizable. Test names use tested-value + expected-outcome (no
"should"). Depends on the shared `dgraph-client` and the spec-trace units.

## Phase 0 — Manifest

- [ ] T301 RED: `shared/src/__tests__/test-command-manifest.test.ts` — parse `.lore/test-commands.yml`; settings override the file; polyglot list with per-`cwd`; `{selector}` substitution; absent manifest → null. GREEN: `shared/src/test-command-manifest.ts` (Zod). REFACTOR.

## Phase 1 — tests.list → TestChunk + VALIDATED_BY

- [ ] T310 RED: parse a real `tests.list` JSON into descriptors `{id,name,file,startLine,endLine,spec?,passed?}`; missing optional fields tolerated. GREEN: parser in `test-command-runner.ts`. REFACTOR.
- [ ] T311 Against real Dgraph: descriptors seed `TestChunk` with the line range + `test_name`; `xid` = runner-native `id` verbatim.
- [ ] T312 [P] A descriptor with `spec="path#ordinal"` creates exactly one `VALIDATED_BY` (`evidence=generated-provenance`) to the single `Statement` at that anchor.
- [ ] T313 [P] A `spec` anchor resolving to an `AcceptanceCriterion` (the `ac` ordinal form) links the criterion, not a statement.

## Phase 2 — tests.run → Coverage + COVERS + violated

- [ ] T320 RED: parse `tests.run` `{passed, covered:[{file,startLine,endLine}]}`; LCOV/Cobertura parse to the same shape. GREEN. REFACTOR.
- [ ] T321 Against real Dgraph: `covered[]` upserts one `Coverage` (`xid=repo|test_file|test_name`) + `COVERS` to each overlapping `CodeChunk`; re-run for `(id, commit)` is idempotent.
- [ ] T322 A failing validating test sets `violated=true` + `violation_reason` on the linked `Statement`/`AcceptanceCriterion` and opens/labels `spec-violated`; this is distinct from `drifted`.
- [ ] T323 [P] Flaky guard: a single failure does NOT raise `violated`; N consecutive failures (or a re-run confirm) does. Test both sides of the threshold.

## Phase 3 — Endpoints

- [ ] T330 RED/GREEN: `POST /api/repos/:o/:r/coverage` (absorbed) parses LCOV and Cobertura → `Coverage`/`COVERS`, idempotent on `commit`; no behavioural regression vs the superseded coverage-ingestion endpoint (port its parser tests).
- [ ] T331 RED/GREEN: `POST /api/repos/:o/:r/test-report` ingests `{commit,branch,tests[],results[]}` → performs T311–T322 in one call; write-scope + bearer auth; idempotent on `commit`. Returns the documented counts.
- [ ] T332 [P] Trigger fan-out: `/test-report` and `/coverage` invoke the spec-trace graph units; test the wiring.

## Phase 4 — CI integration

- [ ] T340 [P] Author per-language `scripts/onboarding-templates/tests/{node,go,python,rust,java}.yml` running `tests.list`+`tests.run` (or the repo's coverage step) and POSTing to `/test-report`.
- [ ] T341 `onboard` task detects toolchain → emits `lore-tests.yml` (one per detected toolchain, subdir-scoped). Test the emission for a Node repo + a polyglot repo.
- [ ] T342 Onboarding test-interface check: when no manifest exists, `onboard` scaffolds a suggested `.lore/test-commands.yml` (+ `lore-tests.yml`) into the PR; when a manifest already exists (file or settings) it reports "configured" and scaffolds nothing (idempotent); a repo that declines the scaffold runs in fallback with no error. Test all three outcomes.

## Phase 5 — Sandbox + trust gate

- [ ] T350 RED: trust-context gate — executor runs in local/CI/claude-runner-pod context; refuses (returns a run-locally error) in the long-lived shared-service context. GREEN: implement the gate. REFACTOR.
- [ ] T351 [P] Bounded timeout → the offending test is skipped (logged), ingest + sibling units continue.

## Phase 6 — MCP tools

- [ ] T360 RED: `list_tests` MCP tool runs `tests.list` in the caller's sandbox and seeds `TestChunk` (+ `VALIDATED_BY` when `spec`); a call with no trusted local sandbox returns a "run in CI/locally" error. GREEN. REFACTOR.
- [ ] T361 `run_test` MCP tool runs `tests.run <id>` in the sandbox, upserts `Coverage`/`COVERS`, and sets `violated` on a confirmed failing validating test — identical outcome to the CI path.
- [ ] T362 [P] `query_trace` MCP tool answers "what validates statement X", "what does test Y cover", "what drifted/violated".
- [ ] T363 [P] Graph writes from the MCP tools proxy through the MCP server to the backend (like memory writes); the shared GKE server refuses to execute commands.

## Phase 7 — Integration + supersede

- [ ] T370 Drift re-verification dispatches a single `tests.run` for the affected test into a trusted sandbox (Claude/MCP, CI, or local); test the dispatch + that the long-lived service never execs.
- [ ] T371 [P] `spec-violated` issue surfacing (reuse `formatBrokenLinksReport()` shape) + add the label to the issue machinery.
- [ ] T372 [P] Generation prompt stamps the `spec` anchor on each generated test (prompt-template change; render/snapshot test).
- [ ] T373 Edits: mark `specs/coverage-ingestion/spec.md` Superseded; add `violated`/`violation_reason` to `Statement`+`AcceptanceCriterion` in the traceability data-model; point the traceability spec + contract at this spec.

## Phase 8 — Local CLI + verify

- [ ] T380 [P] `scripts/trace/run-tests.ts` (`trace:run-tests`) — runs the manifest commands against the working tree and updates the local Dgraph; zero LLM.
- [ ] T384 [P] Store the language-agnostic setup prompt once (`shared/src/test-command-setup-prompt.ts`); render it in the web UI ("Set up test commands", copy-to-clipboard, on specs/coverage + onboarding result) and expose the same text as the `/lore-test-commands` skill. Test: UI surface and skill resolve the identical prompt string; the prompt names no specific language.
- [ ] T385 [P] Conformance: running the prompt against a fixture project (e.g. a non-templated language) produces a `.lore/test-commands.yml` whose `list`/`run` output parses to the contract shapes. (Validated with a recorded/sandboxed run; the parser tests from T310/T320 gate the shapes.)
- [ ] T381 Typecheck clean across `shared/`, `agent/`, `mcp-server/`; full suites green.
- [ ] T382 Manual e2e: declare a manifest on a real repo → `tests.list` seeds `TestChunk` + `VALIDATED_BY` → `tests.run` a passing test → `execution-verified`; make the test fail → `spec-violated` after the flaky guard; edit the implementation → `drifted` (distinct). Confirm CI `lore-tests.yml` posts to `/test-report`.
- [ ] T383 [P] Language-agnostic e2e: repeat for a Go repo (per-file `test_name='*'` aggregate) — `COVERS` + drift still work without per-test attribution.

## Phase 9 — Follow-ups (deferred)

- [ ] F-flaky-policy Make the flaky-guard threshold (N / re-run) per-repo configurable.
- [ ] F-cluster-sandbox Confined cluster sandbox for opt-in non-pod agent execution.
- [ ] F-upload-signing Sign / rate-limit CI uploads to harden the trust boundary.
- [ ] F-list-cache Cache `tests.list` per `commit`; re-list only on a changed test set.
