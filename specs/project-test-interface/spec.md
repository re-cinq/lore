# Feature Specification: Project Test Interface

| Field          | Value                                              |
|----------------|----------------------------------------------------|
| Feature        | Project Test Interface                             |
| Status         | **Shipped**                                          |
| Created        | 2026-06-05                                         |
| Owner          | Platform Engineering                               |
| Supersedes     | `coverage-ingestion` (absorbs its bulk-upload endpoint + parsers) |
| Feeds          | [`spec-traceability-graph`](../spec-traceability-graph/spec.md) — seeds `TestChunk`/`Coverage`/`COVERS`, the `violated` signal, and the `VALIDATED_BY` link |
| Wire contract  | [`contracts/test-commands.md`](./contracts/test-commands.md) |

> **Cutover note (2026-06-29):** the mcp ingest endpoints described below —
> `POST /api/repos/:o/:r/test-report` and `…/coverage` — have been **removed**.
> The manifest contract (`list`/`run`, `contracts/test-commands.md`) is unchanged,
> but the orchestration + ingest moved to the portable **`lore-code-trace`** Go binary
> (`apps/lore-code-trace`): it runs the manifest in CI, parses json/lcov/cobertura to
> canonical ranges itself, and POSTs the report to the Floor **`ci-tests`** hook
> (`POST /api/webhook/ci-tests` → `internal.ingest.spec_trace`, kind `test-report`).
> The acceptance criteria below and their inline `validated by` links to the old route
> tests are historical and pending a re-link pass.

## Problem Statement

The traceability graph needs to know a repo's tests, what code each test
covers, and whether each test currently passes. Inferring this is lossy:

- **Test discovery by file-name pattern** (`isTestFile`) is language-
  specific and misses non-conventional layouts; it can't enumerate the
  individual test cases inside a file.
- **Bulk LCOV upload** (the deferred `coverage-ingestion` design) is
  coarse (per-file aggregate for some tools) and CI-coupled.
- **Nothing tells Lore which test validates which spec statement**
  authoritatively, nor **whether that test passes** — so a spec claim can
  be silently false (its test is red) with no signal distinct from drift.

The project already knows its own tests and runner. Lore should consume
that knowledge through a thin, stable, language-neutral interface rather
than guess.

## Solution

An optional, per-repo **test-command manifest** declaring two commands,
plus the bulk report endpoint absorbed from `coverage-ingestion`. All
output is deterministic and machine-readable; **zero LLM** anywhere in
this path.

- **`tests.list`** → enumerate the repo's tests as descriptors.
- **`tests.run <id>`** → run one test with coverage; return pass/fail +
  the covered code chunks.
- **`lore-code-trace` binary** (`apps/lore-code-trace`) → in CI (or any trusted
  sandbox) it runs the manifest, parses json/lcov/cobertura coverage to canonical
  `{file, startLine, endLine}` ranges **itself**, chunks at 512 KB, and POSTs the
  combined report to the Floor **`ci-tests`** ingress (`POST /api/webhook/ci-tests`)
  to update the graph. (The former mcp `/coverage` + `/test-report` routes — and the
  server-side LCOV/Cobertura parsers — were removed in the cutover; the binary owns
  parsing now.)

Lore consumes the output and updates the [traceability
graph](../spec-traceability-graph/data-model.md): seed `TestChunk`,
upsert `Coverage` + `COVERS`, set the `VALIDATED_BY` link when a
descriptor carries a spec anchor, and raise `violated` when a validating
test fails.

**Execution is sandboxed; Lore never runs project code on its long-lived
services.** Three trusted execution contexts run the commands — the local
dev machine, the repo's CI, and the ephemeral claude-runner Job pod
(which already runs the repo's lint/typecheck/tests during validation).
The shared GKE MCP + agent services only *ingest* results.

### Design decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Pass/fail signal | `tests.run` returns `passed`; a **failing validating test** raises **`spec-violated`** (claim currently broken) — distinct from `drifted` (code changed) | A red test on a statement is a different, stronger signal than drift; both must be visible |
| Spec anchor | Descriptor `spec` = **one** `path#ordinal` anchor → a single `Statement` *or* `AcceptanceCriterion` (one-to-one) | The graph links per statement/criterion; one test declares the one thing it validates |
| Selector / `id` | **Runner-native node id** (pytest `path::Class::test`, vitest file+name, Go `TestX`), opaque to Lore | The project owns its runner; Lore passes the id back verbatim; it's the `Coverage` idempotency key |
| Scope | **Supersedes `coverage-ingestion`** — owns the command interface *and* the bulk upload endpoint + LCOV/Cobertura parsers | One feature owns the whole test+coverage interface |
| Build cost | **Zero-LLM**, deterministic parse | Cheap, local, reproducible |
| Manifest location | `.lore/test-commands.yml` or `lore.repos.settings.test_commands` (settings win); polyglot list with per-`cwd` | Project-declared, monorepo-friendly |
| Idempotency | `(id, commit)` for per-test; `commit` for bulk | CI retries / re-runs don't duplicate |
| Timeout | Bounded per invocation (default 120s) → **skip** the test, logged | A hang never blocks ingest or siblings |
| Trust boundary | Commands run **only** in a trusted sandbox (local / CI / claude-runner pod); the long-lived shared services **refuse to execute** | Running arbitrary project code on shared infra is a security boundary |
| Fallback | No manifest → pattern-based `isTestFile` discovery + bulk LCOV upload | Graceful degradation; the feature still works |
| Flaky guard | A failing test is confirmed (N consecutive failures **or** a single re-run confirm) before `violated` is raised | A flaky red shouldn't permanently mark a spec violated |
| Onboarding check | The `onboard` task **checks for the manifest** and, when absent, detects the toolchain and **scaffolds a suggested `.lore/test-commands.yml` + `lore-tests.yml`** in the onboarding PR (opt-in: the repo merges or drops it) | Surface the optional capability at onboarding instead of leaving it undiscovered; declining = documented fallback |
| UI setup prompt | The web UI offers a **generic, language-agnostic prompt** the developer runs with Claude in the repo; Claude inspects the actual toolchain and **implements the two commands + writes the manifest** to the contract | Robust for any language the per-toolchain templates miss; the model reads the real project rather than Lore guessing |

## User Experience

### Onboarding check (surfaces the optional capability)

The `onboard` task adds a step that checks whether the repo declares a
test-command manifest and, if not, detects the toolchain and proposes one
in the onboarding PR — so the optional interface is offered, not buried.

```
$ lore onboard re-cinq/lore

> Detecting toolchain… package.json + tsconfig.json — Node/TS + Vitest
> Test interface: no .lore/test-commands.yml found.
  Scaffolding (optional — review & keep, or drop this file):
    .lore/test-commands.yml         (suggested tests.list / tests.run)
    .github/workflows/lore-tests.yml (runs them on push/PR → POSTs to Lore)

  Merge to enable authoritative test discovery + per-test coverage
  (execution-verified links + the spec-violated signal).
  Skip it and Lore falls back to pattern detection + bulk coverage upload.

  PR: https://github.com/re-cinq/lore/pull/N
```

- The check is **idempotent**: a repo that already declares a manifest
  (file or `lore.repos.settings.test_commands`) is reported "test
  interface: configured" and nothing is scaffolded.
- Polyglot monorepos get one suggested manifest entry + one
  `lore-tests.yml` per detected toolchain, each scoped to its subdir.
- Declining (not merging the scaffold) is a first-class outcome — the
  feature runs in fallback mode, no error.

### UI setup prompt (language-agnostic — Claude implements the commands)

The web UI surfaces a **generic, copy-pasteable prompt** (a "Set up test
commands" action on the repo's specs/coverage page and in the onboarding
result). The developer runs it with Claude Code **in their project**;
Claude detects the toolchain itself and implements the two commands +
writes the manifest to the contract. The prompt names no language — it
instructs Claude to discover the runner — so it works anywhere the
per-toolchain templates don't.

> **Prompt (rendered by the UI, copy to run with Claude in your repo):**
>
> "Set up the Lore test-command interface for this project. Detect the
> test framework and coverage tooling from the repo (build files, config,
> existing scripts). Implement two commands that emit the exact JSON
> shapes in `.lore/test-commands.yml`'s contract:
> 1. a **list** command that prints a JSON array of
>    `{id, name, file, startLine, endLine, spec?}` — one entry per test,
>    where `id` is the framework's native, stable node id;
> 2. a **run** command taking one `id` that runs only that test with
>    coverage and prints `{passed, covered:[{file, startLine, endLine}]}`.
> Add any thin wrapper scripts needed (e.g. a reporter or a small adapter)
> so the output is exactly those shapes with repo-relative paths. Write
> `.lore/test-commands.yml` with `list`, `run` (using `{selector}`), and
> `coverage_format`. Verify by running both commands and checking the JSON
> parses. Do not change test behaviour."

- The prompt is **stored once** (a template the UI renders) and is also
  exposed as a `/lore-test-commands` skill for in-terminal use — same
  text, two surfaces.
- Output conforms to [`contracts/test-commands.md`](./contracts/test-commands.md);
  the developer reviews/commits the result like any change.
- This is the **generic** path; `onboard`'s per-toolchain scaffold is the
  fast path for the common stacks. Either yields a conformant manifest.

### Declaring the manifest

```yaml
# .lore/test-commands.yml
list: "npm run -s test:list-json"
run:  "npm run -s test:run-json -- {selector}"
coverage_format: "lcov"      # lcov | cobertura | json
cwd: "."                     # optional; per-package for monorepos
```

### Generated-test flow (the link arrives for free)

The implementation/feature task is instructed to stamp the spec anchor it
implements onto each test it writes. `tests.list` then surfaces it, so
discovery alone establishes the `VALIDATED_BY` link:

```
$ npm run -s test:list-json | jq '.[0]'
{
  "id": "mcp-server/src/local-runner.test.ts::claims pending task",
  "name": "claims pending task before GKE picks it up",
  "file": "mcp-server/src/local-runner.test.ts",
  "startLine": 88, "endLine": 121,
  "spec": "specs/local-task-runner/spec.md#14",   # stamped at generation
  "passed": true
}
→ graph: Statement#14 —VALIDATED_BY(generated-provenance)→ TestChunk(…::claims pending task)
```

### Run one test, get its coverage

```
$ npm run -s test:run-json -- "mcp-server/src/local-runner.test.ts::claims pending task"
{ "passed": true,
  "covered": [ { "file": "mcp-server/src/local-runner.ts", "startLine": 42, "endLine": 58 } ] }
→ graph: TestChunk —HAS_COVERAGE→ Coverage —COVERS→ CodeChunk(local-runner.ts:42-58)  [execution-verified]
```

### Violated vs. drifted (two distinct signals)

```
test passes, code changed     → ⚠ drifted        (re-verify the statement)
test FAILS, validates stmt    → ⛔ spec-violated  (the claim is currently false)
```

### Claude in-loop (via MCP)

A generating/dev agent verifies its own work without a CI round-trip:
`lore_list_tests` → write code+test → `lore_run_test <id>` → the statement turns
`execution-verified` (or `spec-violated` if red). Execution happens in the
agent's sandbox; the graph update is proxied through the MCP server.

## Architecture

```
┌──────  Trusted sandbox: CI  |  local dev (stdio MCP/CLI)  |  claude-runner pod  ──────┐
│  tests.list / tests.run <id>   (project's own runner; the only place code executes)   │
│  ── CI: lore-tests.yml runs the lore-code-trace binary, which orchestrates them ──┐   │
│       and parses json/lcov/cobertura → canonical { file, startLine, endLine }      │   │
└────────────────────────────────────────────────────────────────────────────────────┼─┘
                                                                                       ▼ HTTPS (bearer)
┌────────────────────────────  Floor ci-tests hook (GKE, long-lived)  ───────────────────┐
│  POST /api/webhook/ci-tests  { repo, commit, branch, tests[], results[] }              │
│       → internal.ingest.spec_trace (kind test-report) → ingestTestReport              │
│  (mcp MCP tools lore_list_tests / lore_run_test / query_trace still proxy graph reads) │
│     → spec-trace graph units:                                                          │
│         seed TestChunk(range) + VALIDATED_BY (when spec anchor)                        │
│         upsert Coverage + COVERS (by line overlap)                                     │
│         passed=false on a validating test (confirmed) → Statement/AC.violated +        │
│             spec-violated issue                                                         │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

The shared service **never executes** project commands. If an MCP caller
has no trusted local sandbox (e.g. a call hitting the GKE server directly
with no working tree), `lore_run_test`/`lore_list_tests` return a "run in CI /
locally" error.

## API

### `tests.list` / `tests.run` (project commands)

Wire schemas are defined in
[`contracts/test-commands.md`](./contracts/test-commands.md). Summary:

```jsonc
// tests.list → stdout
[ { "id": "file::name",        // runner-native node id (opaque selector)
    "name": "human title",     // → TestChunk.test_name
    "file": "repo/rel/path",
    "startLine": 88, "endLine": 121,
    "suite": ["Outer", "Inner"],   // optional; enclosing describe/class chain, outermost→innermost → TestSuite nesting
    "spec": "specs/x/spec.md#14",  // optional; one anchor (statement|AC)
    "passed": true } ]             // optional snapshot if list also ran

// tests.run <id> → stdout
{ "passed": true,
  "covered": [ { "file": "repo/rel/path", "startLine": 42, "endLine": 58 } ] }
```

## Data Model

No new persistent store of its own. It populates the [traceability
graph](../spec-traceability-graph/data-model.md):

- `TestChunk` — `test_name`, `file_path`, `start_line`/`end_line` (from
  the descriptor range), `xid` = runner-native `id` (fallback chunk UUID).
- `TestSuite` — one per element of the descriptor's `suite` chain
  (`xid = repo|file_path|suite_chain`), nested via `TestSuite.parent`; the
  `TestChunk` links to the innermost via `TestChunk.suite` (`IN_SUITE`).
  When a suite name resolves to a spec `path`/`path#ordinal` anchor
  (deterministic, same grammar as the test `spec` field), `TestSuite.spec`
  (`VALIDATES_SPEC`) is set — a whole suite declared against a spec.
- `Coverage` (`xid = repo|test_file|test_name`) + `COVERS` edges to
  `CodeChunk` by line overlap.
- `VALIDATED_BY` (one-to-one) from the `Statement`/`AcceptanceCriterion`
  named by the descriptor's `spec` anchor, `evidence = generated-provenance`.
- **`violated` + `violation_reason`** — new predicates added to
  `Statement` and `AcceptanceCriterion` in the traceability data-model;
  set when a validating test fails (confirmed past the flaky guard).

Wire shapes (descriptor + covered chunk) live in the contract.

## File Changes

| File | Change |
|------|--------|
| `shared/src/test-command-manifest.ts` | NEW: Zod schema + loader (`.lore/test-commands.yml` / settings; polyglot list) |
| `shared/src/spec-trace/test-command-runner.ts` | NEW: sandboxed `tests.list`/`tests.run` executor + trust-context gate + timeout/flaky guard |
| `apps/lore-code-trace/` | NEW (Go): the portable orchestrator — runs the manifest, parses json/lcov/cobertura → canonical ranges, chunks, POSTs. (Replaced the deleted mcp `coverage.ts`/`test-report.ts` routes + their parsers.) |
| `apps/floor/src/listeners/ci-tests.ts` | NEW: the `POST /api/webhook/ci-tests` ingress → `internal.ingest.spec_trace` (kind `test-report`) → graph fan-out (seeds `TestChunk` + nested `TestSuite` chain). |
| `shared/src/spec-trace/ingest-coverage.ts` | Modify: consume command output, `test-report`, and bulk upload → `Coverage`/`COVERS` |
| `shared/src/spec-trace/drift-check-file.ts` | Modify: `violated` distinct from `drifted`; flaky guard before flagging |
| `mcp-server/src/index.ts` | Modify: register MCP tools `lore_list_tests` / `lore_run_test` / `query_trace` (Zod inputs) |
| `mcp-server/src/routes.ts` | Modify: graph-update proxy for the MCP tools; refuse cluster execution |
| `scripts/onboarding-templates/tests/{node,go,python,rust,java}.yml` | NEW: per-language `lore-tests.yml` CI workflow |
| `scripts/task-types.yaml` (onboard) | Modify: add the **test-interface check** step — detect toolchain, check for an existing manifest, scaffold `.lore/test-commands.yml` + `lore-tests.yml` in the onboarding PR when absent (idempotent; declining = fallback) |
| Generation prompt templates (`scripts/task-types.yaml` / supervisor) | Modify: stamp the `spec` anchor on each generated test |
| `agent/src/lib/escalation.ts` / issue machinery | Add `spec-violated` label (alongside `spec-drift`) |
| `scripts/trace/run-tests.ts` | NEW: local CLI wrapper (`trace:run-tests`) |
| `shared/src/test-command-setup-prompt.ts` (or a prompt template file) | NEW: the single canonical language-agnostic setup-prompt text |
| `web-ui/src/app/repos/[owner]/[repo]/specs/` (+ onboarding result) | Modify: "Set up test commands" action that renders the prompt with copy-to-clipboard |
| `.claude/skills/lore-test-commands/SKILL.md` | NEW: same prompt exposed as a `/lore-test-commands` skill for in-terminal use |
| `specs/coverage-ingestion/spec.md` | Modify: status → **Superseded by** this spec |
| `specs/spec-traceability-graph/data-model.md` | Modify: add `violated` + `violation_reason` to `Statement` + `AcceptanceCriterion`; add the `TestSuite` node (`parent` nesting, `spec` link) + `TestChunk.suite` |
| `specs/spec-traceability-graph/spec.md` | Modify: point test discovery/coverage at this authoritative spec (contract moved here) |
| `CLAUDE.md` | Modify: document the manifest, the lore-code-trace binary + Floor ci-tests hook, and the MCP tools |

## Acceptance Criteria

1. The manifest (`.lore/test-commands.yml` / `lore.repos.settings.test_commands`) is parsed and validated (required `list`/`run`, `{selector}` in `run`, known `coverage_format`); a polyglot list with per-`cwd` entries is supported; settings win over the file; an absent manifest resolves to null so the caller falls back (pattern detection + bulk upload) with no error. ([validated by `normalizes a minimal valid manifest`](libs/shared/src/test-command-manifest.test.ts#L9), [validated by `throws when the run command is missing`](libs/shared/src/test-command-manifest.test.ts#L26), [validated by `throws when the run command omits the {selector} placeholder`](libs/shared/src/test-command-manifest.test.ts#L32), [validated by `throws on an unknown coverage_format`](libs/shared/src/test-command-manifest.test.ts#L38), [validated by `normalizes a polyglot array into one entry per manifest`](libs/shared/src/test-command-manifest.test.ts#L44), [validated by `prefers settings over the file`](libs/shared/src/test-command-manifest.test.ts#L73), [validated by `returns null when neither settings nor file declare a manifest`](libs/shared/src/test-command-manifest.test.ts#L69))
2. `tests.list` output is parsed into descriptors `{id, name, file, startLine, endLine, suite?, spec?, passed?}`; each seeds a `TestChunk` with the line range and `test_name`; the runner-native `id` is stored verbatim as the selector. ([validated by `parses a descriptor carrying every field`](libs/shared/src/test-report.test.ts#L5), [validated by `omits optional fields a descriptor does not declare`](libs/shared/src/test-report.test.ts#L46), [validated by `throws when the required %s is missing`](libs/shared/src/test-report.test.ts#L57), [validated by `carries the suite chain outermost to innermost`](libs/shared/src/test-report.test.ts#L30), [validated by `omits a suite array holding a non-string element`](libs/shared/src/test-report.test.ts#L39))
2a. A descriptor's `suite` chain seeds one idempotent `TestSuite` per element (`xid = repo|file_path|suite_chain`), nested via `TestSuite.parent` outermost→innermost; the `TestChunk` links to the innermost via `TestChunk.suite`; a suite shared by many tests is created once. When a suite name resolves to a spec `path`/`path#ordinal` anchor, `TestSuite.spec` (`VALIDATES_SPEC`) is set; descriptors with no `suite` still seed the bare `TestChunk` (suites are optional).
3. When a descriptor carries `spec`, exactly one `VALIDATED_BY` edge (`evidence = generated-provenance`) is created to the single `Statement` or `AcceptanceCriterion` at that `path#ordinal` anchor.
4. `tests.run <id>` output `{passed, covered[]}` upserts one `Coverage` node (`xid = repo|test_file|test_name`) + `COVERS` edges to each overlapping `CodeChunk`; re-running for the same `(id, commit)` is idempotent. ([validated by `parses passed + a list of covered chunks`](libs/shared/src/test-report.test.ts#L49), [validated by `throws when a covered chunk is missing its line bounds`](libs/shared/src/test-report.test.ts#L60))
5. The binary reports each test's `passed` (json `passed`, or the run command's exit code for lcov/cobertura); a failing **validating** test then sets `violated=true` + `violation_reason` on its `Statement`/`AcceptanceCriterion` and opens/labels a `spec-violated` issue during graph projection (owned by [`spec-traceability-graph`](../spec-traceability-graph/spec.md)) — distinct from `drifted`, raised only after the flaky guard confirms. ([validated by `TestBuildReportParsesLcovRunOutput`](apps/lore-code-trace/report_test.go#L51))
6. The `lore-code-trace` binary parses coverage in CI: json `{passed, covered[]}` inline, and LCOV (incl. `TN:`) / Cobertura normalized to canonical `{file, startLine, endLine}` ranges with contiguous lines collapsed — so the server ingests canonical chunks only (the bulk `/coverage` endpoint + its server-side parsers were removed in the cutover). ([validated by `TestParseLcovCoverageKeepsHitLinesAndCollapsesRanges`](apps/lore-code-trace/coverage_test.go#L8), [validated by `TestParseCoberturaCoverageKeepsHitLines`](apps/lore-code-trace/coverage_test.go#L20), [validated by `TestCollapseRangesSortsAndMergesContiguous`](apps/lore-code-trace/coverage_test.go#L34))
7. The binary POSTs `{repo, commit, branch, tests[], results[]}` to the Floor `ci-tests` hook (`POST /api/webhook/ci-tests`, bearer auth); the listener emits `internal.ingest.spec_trace` (kind `test-report`) → `ingestTestReport` performs criteria 2–6 in one pass; idempotent on `commit`.
8. The whole path is zero-LLM and deterministic; a per-invocation timeout skips the offending test (logged) without blocking ingest or sibling units. ([validated by `rejects when the command outlives the timeout`](apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L43), [validated by `rejects when the command outlives the timeout`](apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L151), [validated by `TestBuildReportSkipsFileWhenRunCommandFails`](apps/lore-code-trace/report_test.go#L78))
9. Project commands execute **only** in a trusted sandbox (local dev, the repo's CI, or the claude-runner Job pod); the long-lived shared MCP/agent services never execute them.
10. MCP tools `lore_list_tests` / `lore_run_test` / `query_trace` run the commands in the caller's sandbox and update the graph through the MCP server (proxied to the backend like memory writes); a call with no trusted local sandbox returns a "run in CI / locally" error instead of executing on the cluster; a failing `lore_run_test` on a validating test sets `violated` identically to the CI path.
11. The `onboard` task emits a per-toolchain `lore-tests.yml` (one per detected toolchain, subdir-scoped for monorepos) that sets up the toolchain, downloads the `lore-code-trace` binary, and runs it `--post` on push/PR (which POSTs to the Floor `ci-tests` hook).
12. The `onboard` task runs a **test-interface check**: when no manifest is declared (neither `.lore/test-commands.yml` nor `lore.repos.settings.test_commands`), it detects the toolchain and scaffolds a suggested `.lore/test-commands.yml` (+ `lore-tests.yml`) in the onboarding PR; when a manifest already exists it reports "configured" and scaffolds nothing (idempotent); declining the scaffold leaves the repo in documented fallback mode with no error.
13. The web UI surfaces a single, language-agnostic **setup prompt** (copy-to-clipboard, on the repo specs/coverage page + onboarding result, and as the `/lore-test-commands` skill) that names no language; running it with Claude in the repo produces a `.lore/test-commands.yml` + any wrapper scripts whose `list`/`run` output conforms to [`contracts/test-commands.md`](./contracts/test-commands.md). The prompt text is stored once and shared by the UI surface and the skill. ([validated by `renders the setup prompt text into the DOM`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/TestCommandsSetup.test.tsx#L12), [validated by `names no concrete language or test runner`](libs/shared/src/test-command-setup-prompt.test.ts#L10), [validated by `copies the full setup prompt to the clipboard on Copy click`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/TestCommandsSetup.test.tsx#L26), [validated by `renders a "Set up test commands" heading`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/TestCommandsSetup.test.tsx#L19), [validated by `surfaces the Set up test commands section`](apps/web-ui/src/app/repos/[owner]/[repo]/specs/RepoSpecsView.test.tsx#L37), [validated by `is a non-empty string`](libs/shared/src/test-command-setup-prompt.test.ts#L5), [validated by `exports a byte-identical constant to the shared source`](apps/web-ui/src/lib/test-command-setup-prompt.test.ts#L23), [validated by `carries the canonical TEST_COMMAND_SETUP_PROMPT verbatim`](libs/shared/src/lore-test-commands-skill.test.ts#L11))
12. Drift re-verification dispatches a single `tests.run` for the affected test into a trusted sandbox (Claude/MCP, CI, or local) — never the long-lived services.
13. `specs/coverage-ingestion/spec.md` is marked **Superseded by** this spec; the traceability spec + contract point at this spec as authoritative for test discovery and coverage.

## Limitations & Open Questions

1. **Per-test attribution is tooling-dependent.** LCOV `TN:` (Vitest/Jest, pytest-cov) gives per-test coverage + pass/fail; Go `-coverprofile` is per-file aggregate (`test_name='*'`, no per-test `passed`). Aggregate rows still beat name-overlap; documented in the report response counts.
2. **Flaky tests.** A flaky red could raise a false `spec-violated`. Mitigation: the flaky guard (N consecutive failures or a re-run confirm). **Open question:** the exact N / re-run policy and whether it's per-repo configurable.
3. **Monorepo path mapping.** Coverage paths must be normalized repo-relative to join `CodeChunk.file_path`; the manifest's `cwd`/`path_prefix_strip` and the CI template own normalization.
4. **Trust on CI-posted results.** A misconfigured or malicious CI could post garbage. Mitigation: write-scope token + the report counts as a smell test; signing/rate-limiting is a follow-up.
5. **Cluster sandbox.** A confined cluster sandbox for opt-in execution (so a non-pod agent could run commands) is deferred; today execution is local / CI / claude-runner pod only.
6. **`tests.list` cost.** Some runners must compile/collect to list. The list result is cached per `commit`; re-list only on a changed test set.
