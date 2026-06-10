# Implementation Plan: Project Test Interface

| Field   | Value                                          |
|---------|------------------------------------------------|
| Feature | Project Test Interface                         |
| Spec    | [spec.md](spec.md)                             |
| Contract| [contracts/test-commands.md](contracts/test-commands.md) |
| Graph   | [../spec-traceability-graph/data-model.md](../spec-traceability-graph/data-model.md) |
| Supersedes | [../coverage-ingestion/spec.md](../coverage-ingestion/spec.md) |
| Status  | Draft                                          |
| Created | 2026-06-05                                     |

## Overview

Give a repo a thin, language-neutral way to expose its tests and their
coverage to Lore: a declared manifest (`tests.list` / `tests.run`) plus
the bulk report endpoint absorbed from `coverage-ingestion`. Lore
consumes the output and updates the traceability graph
(`TestChunk`/`Coverage`/`COVERS`/`VALIDATED_BY`/`violated`). Project code
runs **only** in trusted sandboxes (local / CI / claude-runner pod); the
long-lived shared services only ingest. Everything is deterministic and
zero-LLM. Strict TDD with real fixtures, no mocks.

## Phase 0: Manifest

**Files:** `shared/src/test-command-manifest.ts` (NEW)

Zod schema + loader for `.lore/test-commands.yml` and
`lore.repos.settings.test_commands` (settings win). Support a polyglot
list with per-`cwd`. `{selector}` substitution into `run`. Absent
manifest → loader returns null (caller falls back).

## Phase 1: `tests.list` → TestChunk + VALIDATED_BY

**Files:** `shared/src/spec-trace/test-command-runner.ts` (NEW),
`shared/src/spec-trace/ingest-coverage.ts` (modify)

Parse descriptors `{id, name, file, startLine, endLine, spec?, passed?}`;
seed `TestChunk` (range, `test_name`, `xid = id`); when `spec` present,
create the one-to-one `VALIDATED_BY` (`generated-provenance`) to the
single `Statement`/`AcceptanceCriterion` at the `path#ordinal` anchor.

## Phase 2: `tests.run` → Coverage + COVERS + violated

Parse `{passed, covered[]}`; upsert `Coverage` (`xid =
repo|test_file|test_name`) + `COVERS` to overlapping `CodeChunk`s;
`passed=false` on a validating test → `violated` (gated by the flaky
guard — N consecutive failures or a re-run confirm). Idempotent on
`(id, commit)`.

## Phase 3: Bulk endpoint + test-report endpoint

**Files:** `mcp-server/src/routes/coverage.ts` (absorbed),
`mcp-server/src/routes/test-report.ts` (NEW)

- `POST /coverage` — LCOV/Cobertura parsers (moved from coverage-ingestion)
  → `Coverage`/`COVERS`, idempotent on `commit`.
- `POST /test-report` — `{commit, branch, tests[], results[]}` → fan out
  to Phases 1–2 graph updates in one call.

## Phase 4: CI integration

**Files:** `scripts/onboarding-templates/tests/{node,go,python,rust,java}.yml`
(NEW), `scripts/task-types.yaml` (onboard)

Per-language `lore-tests.yml`: on push/PR run `tests.list` + `tests.run`
(or the repo's normal coverage step) and POST to `/test-report`
(`/coverage` for raw LCOV). The `onboard` task gains a **test-interface
check** step: detect the toolchain, check for an existing manifest
(file or `lore.repos.settings.test_commands`), and when absent scaffold a
suggested `.lore/test-commands.yml` + `lore-tests.yml` into the
onboarding PR (idempotent — "configured" when present; declining =
fallback). Subdir-scoped per detected toolchain for monorepos; same model
as the superseded coverage-ingestion templates.

## Phase 5: Sandboxed executor + trust gate

**File:** `shared/src/spec-trace/test-command-runner.ts`

Execute only when the runtime context is trusted (local stdio, CI, or the
claude-runner Job pod). Bounded timeout → skip (logged). The long-lived
shared MCP/agent services refuse to execute and surface a run-locally
error.

## Phase 6: MCP tools

**Files:** `mcp-server/src/index.ts`, `mcp-server/src/routes.ts`

`list_tests` / `run_test` / `query_trace` (Zod inputs). Execute in the
caller's sandbox; proxy the graph write through the MCP server to the
backend (like memory writes). Shared GKE server refuses to execute →
run-locally error.

## Phase 7: Integration + supersede

- Drift re-verification dispatches a single `tests.run` into a trusted
  sandbox.
- `spec-violated` issue surfacing (reuse the broken-links report shape;
  add the label).
- Generation prompt stamps the `spec` anchor on each generated test.
- Mark `coverage-ingestion` superseded; point the traceability spec +
  contract here.

## Phase 8: UI setup prompt + local CLI + docs

- **Language-agnostic setup prompt** stored once
  (`shared/src/test-command-setup-prompt.ts` or a template file); rendered
  by the web UI ("Set up test commands", copy-to-clipboard, on the repo
  specs/coverage page + onboarding result) and exposed as the
  `/lore-test-commands` skill. Running it with Claude in the repo
  implements the two commands + writes a conformant manifest.
- `scripts/trace/run-tests.ts` (`trace:run-tests`); `CLAUDE.md` paragraph.

## Files Changed Summary

| File | Phase | Change |
|------|-------|--------|
| `shared/src/test-command-manifest.ts` | 0 | NEW schema + loader |
| `shared/src/spec-trace/test-command-runner.ts` | 1,2,5 | NEW sandboxed executor + gate |
| `shared/src/spec-trace/ingest-coverage.ts` | 1–3 | consume command/report/bulk output |
| `shared/src/spec-trace/drift-check-file.ts` | 2,7 | `violated` distinct from `drifted` + flaky guard |
| `mcp-server/src/routes/coverage.ts` | 3 | absorbed bulk LCOV/Cobertura |
| `mcp-server/src/routes/test-report.ts` | 3 | NEW `/test-report` |
| `scripts/onboarding-templates/tests/*.yml` + onboard | 4 | per-language CI workflow |
| `mcp-server/src/index.ts`, `routes.ts` | 6 | MCP tools + exec-refusal proxy |
| generation prompt templates | 7 | stamp `spec` anchor |
| issue machinery | 7 | `spec-violated` label |
| `shared/src/test-command-setup-prompt.ts` | 8 | canonical language-agnostic setup-prompt text (one source) |
| `web-ui/.../specs/` + onboarding result | 8 | "Set up test commands" action renders the prompt (copy-to-clipboard) |
| `.claude/skills/lore-test-commands/SKILL.md` | 8 | same prompt as a `/lore-test-commands` skill |
| `scripts/trace/run-tests.ts` | 8 | local CLI |
| `specs/coverage-ingestion/spec.md` | 7 | Superseded by |
| `specs/spec-traceability-graph/data-model.md` | 7 | `violated`/`violation_reason` predicates |
| `specs/spec-traceability-graph/spec.md` + contract | 7 | point here |
| `CLAUDE.md` | 8 | document manifest + endpoints + MCP tools |

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Arbitrary project-code execution on shared infra | Trust gate: exec only local / CI / claude-runner pod; shared services refuse |
| Flaky test → false `spec-violated` | Flaky guard (N consecutive failures or re-run confirm) before flagging |
| Per-test attribution missing (Go) | `test_name='*'` aggregate fallback; documented |
| Monorepo path mismatch | `cwd`/`path_prefix_strip` + CI template normalize repo-relative |
| Malicious/garbage CI uploads | Write-scope token + report-count smell test; signing/rate-limit follow-up |
| Supersede regression | Bulk endpoint behaviourally unchanged; covered by parser tests |

## Testing Strategy

Real values, no mocks, against a fake project with a real declared
command + real LCOV/Cobertura fixtures: manifest parse/validate;
`tests.list` → `TestChunk`(range) + one-to-one `VALIDATED_BY`;
runner-native `id` round-trip through `tests.run`; `tests.run` →
`Coverage`/`COVERS` by overlap; failing test → `violated`+`spec-violated`
past the flaky guard; bulk parse idempotent on `commit`; timeout→skip;
trust gate refuses cluster context; fallback when no manifest; MCP tool
exec-in-sandbox + graph proxy; supersede edit verified.

## ADR Reference

Folds in [`coverage-ingestion`](../coverage-ingestion/spec.md) and extends
[ADR-008 (AST chunking enables drift detection)](../../adrs/ADR-008-ast-chunking-via-tree-sitter.md).
A follow-up ADR should record: the project test-command interface as the
authoritative test+coverage source, the trusted-sandbox execution model,
and the `violated` (spec-violated) signal distinct from drift.
