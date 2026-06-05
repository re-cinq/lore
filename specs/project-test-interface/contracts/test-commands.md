# Contract: Project Test-Command Manifest

The wire contract for [`project-test-interface`](../spec.md). An
**optional**, per-repo, language-neutral capability manifest: when a repo
declares it, Lore uses the project's own test runner as the authoritative
source of test discovery and per-test coverage instead of inferring tests
from file patterns. Absent the manifest, the feature falls back to
pattern detection + bulk LCOV upload.

The project knows its own runner; this contract is the thin, stable
boundary between Lore and that runner. Two commands, deterministic
machine-readable output, **zero LLM**.

## Where it's declared

Either (repo settings win over the file):

- `.lore/test-commands.yml` in the repo root, or
- `lore.repos.settings.test_commands` (settings UI / DB).

```yaml
# .lore/test-commands.yml
list: "npm run -s test:list-json"
run:  "npm run -s test:run-json -- {selector}"
coverage_format: "lcov"          # lcov | cobertura | json
cwd: "."                         # optional; subdir for monorepo packages
path_prefix_strip: ""            # optional; make coverage paths repo-relative
```

Polyglot monorepos may declare a list of manifests, each with its own
`cwd`.

## `tests.list` — enumerate available tests

Lore runs the `list` command in `cwd`. The command MUST print JSON to
stdout: an array of test descriptors. Exit 0 on success.

```jsonc
// stdout
[
  { "id": "mcp-server/src/local-runner.test.ts::claims pending task",
    "name": "claims pending task before GKE picks it up",
    "file": "mcp-server/src/local-runner.test.ts",
    "startLine": 88, "endLine": 121,
    "spec": "specs/local-task-runner/spec.md#14",   // optional; one anchor
    "passed": true }                                 // optional snapshot
]
```

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | **Runner-native node id** — the project's own stable selector (pytest `path::Class::test`, vitest file+name, Go `TestX`); opaque to Lore; accepted verbatim by `tests.run`. |
| `name` | yes | Human-readable test title → `TestChunk.test_name` |
| `file` | yes | Repo-relative path (after `path_prefix_strip`) |
| `startLine`/`endLine` | no | 1-based line **range** of the test → `TestChunk.start_line`/`end_line`; omitted when the runner can't report it |
| `spec` | no | **One** `path#ordinal` anchor → a single `Statement` *or* `AcceptanceCriterion` the test validates. **Stamped by generation**; seeds the one-to-one `VALIDATED_BY` (`generated-provenance`). Absent for human/legacy tests. |
| `passed` | no | Pass/fail snapshot if listing also ran the test |

Effect: seeds/authoritative-sources `TestChunk` nodes (`xid` = runner-native
`id`, `test_name`, `file_path`, line range) regardless of language or
file-name convention; when `spec` is present, also the one-to-one
`VALIDATED_BY` link.

## `tests.run <id>` — run one test, return covered code + pass/fail

Lore substitutes `{selector}` (a `tests.list` `id`) into the `run`
command and executes it in `cwd`. The command MUST run that single test
with coverage and emit, per `coverage_format`:

- `lcov` / `cobertura`: the coverage report on stdout (scoped to the run);
- `json`: `passed` + a **list of covered chunks**.

```jsonc
// coverage_format: "json"  (stdout)
{
  "passed": true,
  "covered": [
    { "file": "mcp-server/src/local-runner.ts", "startLine": 42, "endLine": 58 },
    { "file": "mcp-server/src/local-runner.ts", "startLine": 71, "endLine": 73 }
  ]
}
```

Effect: upserts one `Coverage` node (`xid = repo|test_file|test_name`) +
`HAS_COVERAGE` from the `TestChunk`, and a `COVERS` edge to each
overlapping `CodeChunk` — the **execution-verified** evidence tier — on
demand, without a full-report upload. `passed: false` on a validating
test raises the **`violated`** signal (after the flaky guard).

## Behaviour & guarantees

| Aspect | Rule |
|--------|------|
| Determinism | Output parsed deterministically; **no LLM** anywhere in this path |
| Idempotency | `tests.run` for the same `(id, commit)` re-upserts the same `Coverage`/`COVERS` |
| Failure | Non-zero exit or unparsable stdout ⇒ the unit logs + skips that test; never blocks ingest or other units |
| Timeout | Each invocation is bounded (default 120s, configurable); a timeout is a skip, logged |
| Path normalization | The command emits repo-relative paths (`cwd` + `path_prefix_strip` help); unmatched paths drop with a logged count |
| Flaky guard | A failing test is confirmed (N consecutive failures **or** a re-run confirm) before `violated` is raised |
| Fallback | No manifest ⇒ pattern-based `isTestFile` discovery + bulk LCOV upload (`POST /api/repos/:o/:r/coverage`) |

## Trust boundary (security)

Running project-declared commands is **opt-in and sandboxed**:

- Executed only in **trusted contexts** — the local developer machine
  (`scripts/trace/*` CLIs / stdio MCP), the **repo's own CI**, or the
  **ephemeral claude-runner Job pod** (already runs the repo's
  lint/typecheck/tests). **Never** arbitrary command execution on the
  long-lived shared MCP/agent services.
- The shared services consume only the *output* (posted via
  `POST /api/repos/:o/:r/test-report` or `…/coverage`), or proxy the graph
  write for an MCP tool whose command ran in the caller's sandbox.
- A confined cluster sandbox for opt-in execution is a deferred follow-up
  (F-cluster-sandbox).

## Ingest endpoints (CI / trusted sandbox → Lore)

- `POST /api/repos/:o/:r/test-report` — `{ commit, branch, tests[], results[] }`
  (the combined `tests.list` + `tests.run` output) → graph update. Every
  `covered[]` is the standard JSON list `{ file, startLine, endLine }`.
- `POST /api/repos/:o/:r/coverage` — bulk. **Canonical body is the same
  standard JSON list** `{ file, startLine, endLine }` (optionally grouped
  per test); LCOV/Cobertura are also accepted and normalized to it.
  Idempotent on `commit`.

The covered-chunk shape is identical everywhere — `tests.run` output, the
`test-report` `covered[]`, and the bulk `/coverage` body all use
`{ file, startLine, endLine }`. LCOV/Cobertura are input formats Lore
normalizes into this one shape.

## MCP tools

`list_tests` / `run_test` / `query_trace` (see [`../spec.md`](../spec.md)) run
the commands in the caller's sandbox and update the graph through the MCP
server; the shared GKE server refuses to execute and returns a
"run in CI / locally" error.

## Closed-loop drift re-verification

When a `CodeChunk` drifts and a covering test exists, Lore MAY (when the
manifest is present and re-verify is enabled) call `tests.run` on just
that test to refresh its `Coverage` and confirm whether the
`Statement → … → CodeChunk` link still holds — turning a drift flag into a
re-checked fact, still with zero LLM.

## Example manifests

```yaml
# Node / Vitest
list: "vitest list --reporter=json"
run:  "vitest run {selector} --coverage --coverage.reporter=lcov"
coverage_format: "lcov"
```

```yaml
# Python / pytest
list: "pytest --collect-only -q --json"
run:  "pytest '{selector}' --cov --cov-report=lcov:/dev/stdout"
coverage_format: "lcov"
```

```yaml
# Go (per-file aggregate; test_name='*')
list: "go test ./... -list '.*' -json"
run:  "go test -run '{selector}' -coverprofile=/dev/stdout ./..."
coverage_format: "go-cover"
```
