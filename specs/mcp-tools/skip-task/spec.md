# Feature Specification: lore_skip_task MCP Tool

| Field   | Value                                          |
|---------|------------------------------------------------|
| Feature | lore_skip_task MCP Tool                             |
| Status  | In Progress                                    |
| Created | 2026-06-10                                     |
| Owner   | Platform Engineering                           |
| Tool    | `lore_skip_task`                                    |
| Module  | Pipeline (`features/pipeline/runner.local.ts`) |
| Scope   | local                                          |

`lore_skip_task` removes one task from the local pending-tasks notification cache so it stops appearing in the statusline, without changing server-side task state.

## Problem Statement

A pending-task notification surfaced in the statusline is a prompt, not an
obligation. When a developer decides not to run a task locally, they need to
dismiss the notification — without modifying server state — so GKE picks the
task up after its grace period. `lore_skip_task` removes the task from the local
pending cache.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L486)).

- **name**: `lore_skip_task`
- **description** (verbatim):

```text
Removes one task from the local ~/.lore/pending-tasks.json notification cache so it stops appearing in the statusline. Local only — does NOT change server state (task stays 'pending'). Instead: lore_cancel_task to cancel server-side; lore_complete_task to mark a claimed spec-task done.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `task_id` | string | yes | — | Task id to skip. |

## Behavior

1. Dynamically import `skipTask` from `runner.local`
   ([handler](../../../apps/mcp-server/src/features/pipeline/runner.local.ts#L897)) and call it
   with `task_id`. `skipTask` reads `~/.lore/pending-tasks.json` via
   `listPendingTasks`, filters out the entry whose `id === task_id`, and writes
   the remaining array back to the same file. The task stays `pending` on the
   server.
2. Return `"Task {task_id} skipped. GKE will handle it."`.
3. Any thrown error → `"Error: {message}"`.

## Output

A single MCP text content block: the skipped-confirmation message or the error
message. Never throws.

## Dependencies & side effects

- `skipTask` → `listPendingTasks` (reads + rewrites `~/.lore/pending-tasks.json`).
- No env vars, no network, no DB.

## Acceptance Criteria

Skipping a task removes only the entry matching the given id from the pending
list, leaving the others. ([validated by `runner.local.test.ts:172`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L172))

The dynamic import and the success/error message framing run only inside the
tool handler. *(untested: `skipTask` reads/writes a `~/.lore/pending-tasks.json`
path captured at module load, so exercising the real function would mutate the
developer's home dir; the filter semantics are covered above against the same
filter expression.)*

## Out of Scope

- Cancelling server-side task state (the task stays `pending`) — see `lore_cancel_task`.
- The notifier that populates the pending cache — see [`lore_enable_task_notifications`](../enable-task-notifications/spec.md).
