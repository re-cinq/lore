# Feature Specification: lore_list_tests MCP Tool

| Field   | Value                                       |
|---------|---------------------------------------------|
| Feature | lore_list_tests MCP Tool                         |
| Status  | **Draft**                                   |
| Created | 2026-06-10                                  |
| Owner   | Platform Engineering                        |
| Tool    | `lore_list_tests`                                |
| Module  | Spec-Trace (`spec-trace-tools.ts`)          |
| Scope   | local                                       |

## Problem Statement

The spec-traceability graph needs the repo's authoritative list of tests — the
runner-native ids, files, and line ranges — discovered by the project's own test
runner rather than guessed by pattern matching. `lore_list_tests` runs the repo's
declared `list` command (from `.lore/test-commands.yml`) in the caller's local
sandbox and returns the normalized test descriptors. Because the command is
arbitrary shell, it must execute only where execution is trusted — the developer
machine, CI, or a claude-runner pod — never on the shared GKE server.

## Interface

Registered via `server.tool` ([registration](../../../apps/mcp-server/src/mcp/tools/spec-trace-tools.local.ts#L7)).

- **name**: `lore_list_tests`
- **description** (verbatim):

```text
Runs the repo's .lore/test-commands.yml 'list' command and returns a JSON array of test descriptors {id, name, file, startLine?, endLine?, suite?, spec?}; 'id' is the selector to pass to lore_run_test. Use to discover available tests before running one. Instead: to run a test and see coverage use lore_run_test; to read built-graph coverage without executing use lore-query-trace.
Trusted-sandbox only — executes a shell command in your local checkout. The shared cluster server refuses and returns "Test commands run only in a trusted sandbox — run in CI or locally."
```

### Input schema (Zod)

The tool takes **no input** — the Zod shape is the empty object `{}`. The repo
root and manifest are resolved at call time, not passed by the caller.

## Behavior

1. Resolve the repo root: `getRepoRoot()` (git toplevel of the cwd) or fall back
   to `process.cwd()`.
2. Load the manifest with `loadTestCommandManifest(root)`
   ([loader](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.ts#L202)) —
   reads `<root>/.lore/test-commands.yml`, parses the YAML, and resolves it to a
   `TestCommandManifest` (or `null` when the file is absent).
3. Delegate to `listTestsTool(process.env, manifest, root)`
   ([handler](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.ts#L82)):
   1. **Trust-boundary gate** — `executionRefusal(env)`
      ([gate](../../../libs/shared/src/project/lib/trust.ts#L11)) returns a non-null
      string when `LORE_DB_HOST` is set (i.e. the shared cluster server). When
      non-null, return it immediately **without running the list command**.
   2. **Manifest precondition** — when `manifest` is `null`, return the literal
      `"No test-command manifest declared for this repo."`.
   3. Run the `list` command via `runTestsList(manifest.list, resolveCwd(...))`
      under a timeout (a runaway command is killed and the call rejects); parse
      stdout into `TestDescriptor[]` (rejects naming the list command if stdout
      is not JSON).
   4. Strip `manifest.path_prefix_strip` from each descriptor's `file` and
      `JSON.stringify` the array.
4. Any thrown error is caught by the registration wrapper and returned as
   `"Error: {message}"`.

## Output

A single MCP text content block. One of, in priority order: the trust-boundary
refusal `"Test commands run only in a trusted sandbox — run in CI or locally."`,
the `"No test-command manifest declared for this repo."` text, a JSON array of
`{id,name,file,startLine?,endLine?,suite?,spec?}` descriptors, or `"Error: …"`.
**Never throws** — every path returns text.

## Dependencies & side effects

- `getRepoRoot()` (shells `git rev-parse --show-toplevel`), `loadTestCommandManifest`
  (reads `<root>/.lore/test-commands.yml`).
- `executionRefusal(env)` keyed on `LORE_DB_HOST`.
- `runTestsList` spawns the manifest's `list` command through a shell in
  `resolveCwd(manifest, root)` — **arbitrary command execution**, timeout-bounded.
- No DB, no network, no writes.

## Acceptance Criteria

`executionRefusal` returns a non-empty refusal string when `LORE_DB_HOST` is set.
([validated by `returns a non-empty string when LORE_DB_HOST is set`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L20))

`executionRefusal` returns null on a local sandbox where `LORE_DB_HOST` is unset.
([validated by `returns null when LORE_DB_HOST is unset`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L26))

The refusal text names CI / local as the remedy.
([validated by `names the remedy of running in CI or locally when refusing`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L30))

The tool returns the CI-or-local refusal without running the list command when
`LORE_DB_HOST` is set. ([validated by `returns the CI-or-local refusal without running the list command on the cluster`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L115))

A null manifest yields the "no manifest declared" message on a local sandbox.
([validated by `reports no manifest declared when the manifest is null on a local sandbox`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L127))

A local sandbox with a manifest runs the list command and returns the parsed
descriptors. ([validated by `runs the list command and returns the descriptors on a local sandbox`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L132))

`runTestsList` returns parsed descriptors from the list command stdout.
([validated by `returns parsed descriptors from the list command stdout`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L91))

`runTestsList` rejects when the command outlives the timeout.
([validated by `rejects when the command outlives the timeout`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L101))

`runTestsList` rejects naming the list command when stdout is not JSON.
([validated by `rejects naming the list command when stdout is not JSON`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L107))

`loadTestCommandManifest` returns the parsed manifest from `.lore/test-commands.yml`.
([validated by `returns the manifest parsed from .lore/test-commands.yml`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L173))

`loadTestCommandManifest` returns null when no manifest file exists.
([validated by `returns null when no .lore/test-commands.yml exists`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L190))

`path_prefix_strip` is removed from descriptor file paths.
([validated by `removes a matching leading prefix`](../../../apps/mcp-server/src/features/spec-trace/spec-trace-tools.test.ts#L375))

The registration wrapper's `getRepoRoot()` cwd-resolution and `Error: …` framing
are exercised only end-to-end through the live MCP server. *(untested: the thin
registration closure shells out to `git rev-parse` and has no unit seam; the
`listTestsTool` orchestration it calls is covered above.)*

## Out of Scope

- The `run` command path — owned by [`run-test`](../run-test/spec.md).
- Graph persistence of the discovered tests (Dgraph projection — deferred seam).
- Manifest schema authoring and resolution internals (`@re-cinq/lore-shared`).
