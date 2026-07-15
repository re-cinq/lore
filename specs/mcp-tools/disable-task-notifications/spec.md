# Feature Specification: lore_disable_task_notifications MCP Tool

| Field   | Value                                          |
|---------|------------------------------------------------|
| Feature | lore_disable_task_notifications MCP Tool            |
| Status  | **Draft**                                      |
| Created | 2026-06-10                                     |
| Owner   | Platform Engineering                           |
| Tool    | `lore_disable_task_notifications`                   |
| Module  | Pipeline (`features/pipeline/runner.local.ts`) |
| Scope   | local                                          |

## Problem Statement

A developer who turned on pending-task notifications needs a clean way to stop
the background poller and clear the statusline. `lore_disable_task_notifications`
tears down the interval and removes the pending cache file.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L534)).

- **name**: `lore_disable_task_notifications`
- **description** (verbatim):

```text
Stops the local pending-task notifier and removes the ~/.lore/pending-tasks.json cache. Undoes lore_enable_task_notifications. Idempotent.
```

### Input schema (Zod)

This tool takes no parameters.

## Behavior

1. Dynamically import `stopNotifier` from `runner.local` and call it
   ([handler](../../../apps/mcp-server/src/features/pipeline/runner.local.ts#L863)). It:
   1. If the module-level interval handle is set, `clearInterval` it and null the handle.
   2. Best-effort `fs.unlinkSync(~/.lore/pending-tasks.json)`; a missing file is swallowed.
2. Return `"Task notifications stopped."`.
3. Any thrown error → `"Error: {message}"`.

## Output

A single MCP text content block: the stopped-confirmation message or the error
message. Never throws. (Idempotent: calling it when no notifier is running still
returns the success message.)

## Dependencies & side effects

- `stopNotifier` → `clearInterval` + `fs.unlinkSync(~/.lore/pending-tasks.json)`.
- No env vars, no network, no DB.

## Acceptance Criteria

The handler clears the polling interval and removes the pending cache file.
*(untested: `stopNotifier` mutates the module-level `setInterval` handle and
unlinks a `~/.lore` path captured at module load; verifying it would require
first starting a real polling timer and mutating the developer's home dir — no
unit seam.)*

## Out of Scope

- Starting the notifier — see [`lore_enable_task_notifications`](../enable-task-notifications/spec.md).
- The cache file's consumers (statusline, [`lore_list_pending_tasks`](../list-pending-tasks/spec.md)).
