# Feature Specification: lore_enable_task_notifications MCP Tool

| Field   | Value                                          |
|---------|------------------------------------------------|
| Feature | lore_enable_task_notifications MCP Tool             |
| Status  | In Progress                                    |
| Created | 2026-06-10                                     |
| Owner   | Platform Engineering                           |
| Tool    | `lore_enable_task_notifications`                    |
| Module  | Pipeline (`features/pipeline/runner.local.ts`) |
| Scope   | local                                          |

`lore_enable_task_notifications` starts a background poller that watches chosen repos for new pending pipeline tasks and writes matches to a cache file the statusline reads — a read-only surfacing mechanism that never claims or mutates tasks.

## Problem Statement

A developer wants to be told when new pending pipeline tasks appear on the repos
they work with, so they can choose to run one locally instead of waiting for
GKE. `lore_enable_task_notifications` starts a background poller that writes matching
pending tasks to a cache file the statusline reads — a read-only notification
mechanism that never claims or mutates tasks.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L503)).

- **name**: `lore_enable_task_notifications`
- **description** (verbatim):

```text
Starts a local background poller that watches repos for new 'pending' pipeline tasks and writes matches to ~/.lore/pending-tasks.json for the statusline. Idempotent — returns 'already active' if running. To stop it: lore_disable_task_notifications. To run a surfaced task: lore_claim_and_run_locally. To dismiss one: lore_skip_task.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `repos` | string[] | no | — | Repos to watch as `owner/repo`. Defaults to current git remote. |
| `task_types` | string[] | no | — | Task types to surface. Defaults to implementation, general, runbook, gap-fill. |

## Behavior

1. Dynamically import `startNotifier`, `detectRepo`, `isNotifierRunning` from
   `runner.local`.
2. If `isNotifierRunning()`
   ([handler](../../../apps/mcp-server/src/features/pipeline/runner.local.ts#L1296)) → return
   `"Task notifications already active."` (idempotent — single interval).
3. Resolve `repos = args.repos || [detectRepo()].filter(Boolean)`. If empty →
   `"Error: no repos to watch. Pass repos explicitly or run from a git repo with a GitHub remote."`.
4. Resolve `taskTypes = args.task_types || ["implementation","general","runbook","gap-fill"]`.
5. `startNotifier(repos, taskTypes)`
   ([handler](../../../apps/mcp-server/src/features/pipeline/runner.local.ts#L1246)): sets a 30s
   `setInterval` (runs once immediately) that calls `fetchPendingTasks` (direct
   DB query when a pool is available, else `POST /api/task` `{action:"list"}`)
   and writes the matched tasks to `~/.lore/pending-tasks.json`. Every 5th cycle
   it also runs `cleanupStaleTasks()`.
6. Return
   `"Watching for pending tasks on {repos joined}.\nTypes: {types joined}\nCheck the statusline for new tasks."`.
7. Any thrown error → `"Error: {message}"`.

## Output

A single MCP text content block: the watching-confirmation, the already-active
message, the no-repos error, or the generic error. Never throws.

## Dependencies & side effects

- `isNotifierRunning`, `detectRepo`, `startNotifier` → `fetchPendingTasks`,
  `cleanupStaleTasks`.
- Starts a module-level `setInterval`; writes `~/.lore/pending-tasks.json`.
- Env (inside `fetchPendingTasks`): `LORE_API_URL`, `LORE_INGEST_TOKEN` (or git
  config fallbacks). DB: reads `pipeline.tasks` when a pool is supplied.

## Acceptance Criteria

The notifier exposes a running-state predicate that the handler checks for
idempotency. *(untested: `isNotifierRunning` reflects a module-level
`setInterval` handle; asserting state would start a real 30s polling timer that
hits the API/DB and writes the developer's `~/.lore` cache — no unit seam.)*

The repo-default (`detectRepo`), no-repos guard, task-type default, and
message framing run only inside the tool handler. *(untested: starting the
notifier spawns a live polling interval with file/network/DB side effects; there
is no pure seam for the orchestration.)*

`fetchPendingTasks` returns `[]` without querying the DB or the API when
`repos` or `task_types` is empty; queries the DB pool when one is supplied and
maps its rows; falls through to the API when the DB query throws; returns `[]`
when no API credentials are configured or the API responds non-2xx; and
filters the API's tasks down to the requested repos and task types.
([validated by `returns an empty array without querying anything when repos or
task types are empty`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L486),
[`returns rows from the DB pool when one is
provided`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L501),
[`falls through to the API when the DB query
throws`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L535),
[`returns an empty array when no API credentials are
configured`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L579),
[`returns an empty array when the API responds
non-ok`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L585),
[`filters API results down to the requested repos and task
types`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L595))

`cleanupStaleTasks` resolves without throwing when there are no
locally-tracked tasks to recover. ([validated by `resolves without throwing
when there are no locally-tracked tasks to
recover`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L626))

A task whose PID has died is marked failed regardless of how long it ran,
while a task whose PID is still alive is left untouched. ([validated by
`marks dead tasks failed and leaves a live one running, unaffected by
staleness age`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L656))

## Out of Scope

- Reading the cache the notifier writes — see [`lore_list_pending_tasks`](../list-pending-tasks/spec.md).
- Stopping the notifier — see [`lore_disable_task_notifications`](../disable-task-notifications/spec.md).
- Stale-task cleanup / re-queue semantics (`cleanupStaleTasks`).
