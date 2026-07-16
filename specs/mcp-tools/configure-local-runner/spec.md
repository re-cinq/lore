# Feature Specification: lore_configure_local_runner MCP Tool

| Field   | Value                                       |
|---------|---------------------------------------------|
| Feature | lore_configure_local_runner MCP Tool             |
| Status  | In Progress                                 |
| Created | 2026-06-10                                  |
| Owner   | Platform Engineering                        |
| Tool    | `lore_configure_local_runner`                    |
| Module  | Pipeline (`runner.local.ts`)                |
| Scope   | local                                       |

`lore_configure_local_runner` views or updates the local task runner's config — the repos and task-types the notifier watches plus concurrency and default-model limits — so a developer changes settings without hand-editing the JSON file.

## Problem Statement

The local task runner watches a set of repos/task-types and bounds concurrency
and default model. A developer needs to view the current settings and update them
without hand-editing JSON. `lore_configure_local_runner` reads the config, applies any
provided fields, and persists.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/local-runner-tools.local.ts#L208)).

- **name**: `lore_configure_local_runner`
- **description** (verbatim):

```text
Views or updates the local runner config on your machine; returns current config as JSON when called with no arguments, or writes provided fields and returns 'Config updated:' + JSON. Controls which repos/task-types the local notifier watches and local concurrency/model limits. To run work locally use lore_run_task_locally (new task) or lore_claim_and_run_locally (existing task).
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `max_concurrent` | number | no | — | Max simultaneous local background tasks (positive integer). |
| `repos` | string[] | no | — | owner/repo slugs the local notifier watches (e.g. ['re-cinq/lore']). Replaces the whole list. |
| `task_types` | string[] | no | — | Task-type names eligible to run locally. Replaces the whole list. |
| `model` | string | no | — | Default model id for local tasks (e.g. 'claude-sonnet-4-6'). |

## Behavior

1. `readConfig()`
   ([reader](../../../apps/mcp-server/src/features/pipeline/runner.local.ts#L41)) —
   parse `~/.lore/local-runner.json`; on any read/parse failure return the
   defaults `{enabled:false, max_concurrent:2, repos:[], task_types:
   ["implementation","general","runbook","gap-fill"], model:"claude-sonnet-4-6"}`.
2. **View mode** — when no argument is provided (`max_concurrent`, `repos`,
   `task_types`, `model` all falsy), return the current config as pretty JSON.
3. **Update mode** — overwrite each provided field
   (`max_concurrent` is applied only when `!== undefined`), then `writeConfig`
   ([writer](../../../apps/mcp-server/src/features/pipeline/runner.local.ts#L49))
   (mkdir-p the parent, write pretty JSON) and return `"Config updated:\n{json}"`.
4. Any thrown error is caught and returned as `"Error: {message}"`.

> **Trust boundary**: registered only in the local MCP server (`*.local.ts`); the
> config lives at `~/.lore/local-runner.json` on the developer machine and has no
> meaning on the shared GKE server.

## Output

A single MCP text content block: the pretty-printed current config (view mode),
`"Config updated:\n{json}"` (update mode), or `"Error: {message}"`. Never throws.

## Dependencies & side effects

- `readConfig()` reads `~/.lore/local-runner.json` (defaults on failure).
- `writeConfig()` mkdir-ps and writes `~/.lore/local-runner.json`.
- No DB, no network.

## Acceptance Criteria

`readConfig` returns a config with the expected shape (all five fields, correct
types). ([validated by `runner.local.test.ts:83`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L83))

The default config carries sensible values (`max_concurrent` 2, includes
`implementation`/`general`, model `claude-sonnet-4-6`).
([validated by `runner.local.test.ts:100`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L100))

The config serializes and round-trips through JSON unchanged.
([validated by `runner.local.test.ts:127`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L127))

The update merge keeps untouched fields and overwrites only provided ones.
([validated by `runner.local.test.ts:310`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L310))

`writeConfig` writing to the live `~/.lore/local-runner.json` path is exercised
only end-to-end. *(untested: `readConfig`/`writeConfig` use a module-load-fixed
`~/.lore` path; verifying the real file write would clobber the developer's
config and is not redirectable post-import without mocking. The serialization and
merge logic are covered above.)*

## Out of Scope

- The notifier loop that consumes `repos`/`task_types` (`startNotifier`).
- Enabling/disabling the runner (`enabled` flag is read here but toggled elsewhere).
