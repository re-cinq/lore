# Feature Specification: lore_list_local_tasks MCP Tool

| Field   | Value                                       |
|---------|---------------------------------------------|
| Feature | lore_list_local_tasks MCP Tool                   |
| Status  | In Progress                                 |
| Created | 2026-06-10                                  |
| Owner   | Platform Engineering                        |
| Tool    | `lore_list_local_tasks`                          |
| Module  | Pipeline (`runner.local.ts`)                |
| Scope   | local                                       |

`lore_list_local_tasks` reads the local task registry and prints a one-line summary per background task — status, repo, branch, PR URL, and error — reconciling stale running rows whose process has already died.

## Problem Statement

A developer running background tasks needs to see what is running, completed, or
failed, and whether a PR was opened. `lore_list_local_tasks` reads the local task
registry, reconciles stale "running" rows whose process has died, and prints a
one-line summary per task.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/local-runner-tools.local.ts#L123)).

- **name**: `lore_list_local_tasks`
- **description** (verbatim):

```text
Lists all background tasks tracked on your local machine (running, completed, failed) with status, repo, branch, PR URL, and error. Instead of this: for server-side pipeline tasks use lore_list_pipeline_tasks; for unclaimed server tasks use lore_list_pending_tasks; for dependency-satisfied spec tasks use lore_ready_tasks; for multi-repo group rollup use lore_list_task_group.
```

### Input schema (Zod)

The tool takes **no input** — the Zod shape is the empty object `{}`.

## Behavior

1. Call `listLocalTasks()`
   ([reader](../../../apps/mcp-server/src/features/pipeline/runner.local.ts#L976)):
   read `~/.lore/local-tasks.json`; for every task whose `status === "running"`
   but whose PID is no longer alive (`process.kill(pid, 0)` throws), set
   `status = "failed"` and `error = "Process exited unexpectedly"`; persist if any
   row changed; return the array.
2. When the array is empty, return the literal `"No local tasks."`.
3. Otherwise format one line per task:
   `<8-char id> <status> <repo> <branch>` then ` → <prUrl>` when present and
   ` ✗ <error>` when present; join with newlines.
4. Any thrown error is caught and returned as `"Error: {message}"`.

> **Trust boundary**: registered only in the local MCP server (`*.local.ts`); the
> reader operates on the local `~/.lore` registry, which does not exist on the
> shared GKE server.

## Output

A single MCP text content block: `"No local tasks."`, the newline-joined task
summary, or `"Error: {message}"`. **Never throws**.

## Dependencies & side effects

- `listLocalTasks()` reads (and may rewrite) `~/.lore/local-tasks.json`.
- `process.kill(pid, 0)` liveness probe — sends no signal.
- No DB, no network.

## Acceptance Criteria

`listPendingTasks` returns an array (empty when the backing file is absent).
([validated by `listPendingTasks returns empty array when file is missing`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L145))

The live-PID reconciliation of `listLocalTasks` and the per-line formatting are
exercised only end-to-end. *(untested: `listLocalTasks` reads
`~/.lore/local-tasks.json` at a module-load-fixed path and probes live PIDs; the
registry path is not redirectable post-import without mocking `fs`/`process.kill`,
which the no-mocks convention forbids.)*

## Out of Scope

- Pending (unclaimed) pipeline tasks — surfaced by `lore_list_pending_tasks`.
- Stale-task re-queue (`cleanupStaleTasks`, notifier loop).
