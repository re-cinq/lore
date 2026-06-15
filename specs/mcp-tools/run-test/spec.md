# Feature Specification: lore_run_test MCP Tool

| Field   | Value                                       |
|---------|---------------------------------------------|
| Feature | lore_run_test MCP Tool                           |
| Status  | **Draft**                                   |
| Created | 2026-06-10                                  |
| Owner   | Platform Engineering                        |
| Tool    | `lore_run_test`                                  |
| Module  | Spec-Trace (`spec-trace-tools.ts`)          |
| Scope   | local                                       |

## Problem Statement

To attach per-test coverage to the spec-traceability graph, the system needs to
run one test and learn which code chunks it exercises. `lore_run_test` runs a single
test by its runner-native id through the repo's declared `run` command (from
`.lore/test-commands.yml`) in the caller's local sandbox and returns the
pass/fail outcome plus the covered code ranges. As with `lore_list_tests`, the
arbitrary `run` command may execute only in a trusted sandbox, never on the
shared GKE server.

## Interface

Registered via `server.tool` ([registration](../../../apps/mcp-server/src/mcp/tools/spec-trace-tools.local.ts#L23)).

- **name**: `lore_run_test`
- **description** (verbatim): *"Run one test by its runner-native id via the
  repo's test-command manifest; returns pass/fail + the covered code chunks.
  Executes in your local sandbox; the shared cluster server refuses and tells you
  to run in CI or locally."*

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `selector` | string | yes | — | Runner-native test id from `lore_list_tests` (e.g. pytest `path::Class::test`, vitest file+name, Go `TestX`). Substituted into the manifest's `run` command at the `{selector}` placeholder. |

## Behavior

1. Resolve the repo root: `getRepoRoot()` or fall back to `process.cwd()`.
2. Load the manifest with `loadTestCommandManifest(root)`
   ([loader](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.ts#L202)).
3. Delegate to `runTestTool(process.env, manifest, selector, root)`
   ([handler](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.ts#L96)):
   1. **Trust-boundary gate** — `executionRefusal(env)`
      ([gate](../../../libs/shared/src/project/lib/trust.ts#L11)) returns a non-null
      string when `LORE_DB_HOST` is set. When non-null, return it immediately
      **without running the run command**.
   2. **Manifest precondition** — when `manifest` is `null`, return
      `"No test-command manifest declared for this repo."`.
   3. Run via `runTestsRun(manifest.run, selector, resolveCwd(...))`: substitute
      `{selector}` into the command, execute under a timeout (runaway → kill +
      reject), and parse stdout into a `RunResult` `{passed, covered:[{file,
      startLine, endLine}]}` (rejects naming the run command if not JSON).
   4. Strip `manifest.path_prefix_strip` from each covered chunk's `file` and
      `JSON.stringify` the result.
4. Any thrown error is caught by the registration wrapper and returned as
   `"Error: {message}"`.

## Output

A single MCP text content block. One of, in priority order: the trust-boundary
refusal `"Test commands run only in a trusted sandbox — run in CI or locally."`,
the `"No test-command manifest declared for this repo."` text, a JSON
`{passed:boolean, covered:[{file,startLine,endLine}]}` object, or `"Error: …"`.
**Never throws**.

## Dependencies & side effects

- `getRepoRoot()`, `loadTestCommandManifest`.
- `executionRefusal(env)` keyed on `LORE_DB_HOST`.
- `runTestsRun` spawns the manifest's `run` command (with `{selector}`
  substituted) through a shell — **arbitrary command execution**, timeout-bounded.
- No DB, no network, no writes.

## Acceptance Criteria

The tool returns the CI-or-local refusal without running the run command when
`LORE_DB_HOST` is set. ([validated by `returns the CI-or-local refusal without running the run command on the cluster`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L148))

The null-manifest precondition shares its branch with `listTestsTool` and is
covered there. *(untested for `runTestTool` specifically: no dedicated
null-manifest case exists for the run path; the identical guard on the list path
is [validated by `reports no manifest declared when the manifest is null on a local sandbox`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L127).)*

`runTestsRun` substitutes the selector into the run command before executing.
([validated by `substitutes the selector into the run command before executing`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L344))

`runTestsRun` rejects when the command outlives the timeout.
([validated by `rejects when the command outlives the timeout`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L356))

`runTestsRun` rejects naming the run command when output is not JSON.
([validated by `rejects naming the run command when output is not JSON`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L367))

`path_prefix_strip` is removed from covered-chunk file paths.
([validated by `removes a matching leading prefix`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L375))

The registration wrapper's `getRepoRoot()` cwd-resolution and `Error: …` framing
are exercised only end-to-end through the live MCP server. *(untested: the thin
registration closure has no unit seam; the `runTestTool` orchestration it calls
is covered above.)*

## Out of Scope

- The `list` command path — owned by [`lore_list_tests`](../list-tests/spec.md).
- Full-suite report assembly (`buildTestReport`) and report chunking — used by the
  `trace:run-tests` CLI, not this tool.
- Graph persistence of coverage edges (Dgraph projection — deferred seam).
