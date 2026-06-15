# Feature Specification: lore_list_pending_tasks MCP Tool

| Field   | Value                                          |
|---------|------------------------------------------------|
| Feature | lore_list_pending_tasks MCP Tool                    |
| Status  | **Draft**                                      |
| Created | 2026-06-10                                     |
| Owner   | Platform Engineering                           |
| Tool    | `lore_list_pending_tasks`                           |
| Module  | Pipeline (`features/pipeline/runner.local.ts`) |
| Scope   | local                                          |

## Problem Statement

A developer running Claude Code locally wants to see backlog pipeline tasks they
could claim and run on their own machine (zero API cost) before the GKE agent
picks them up. `lore_list_pending_tasks` shows pending tasks across all repos by
default, preferring a live API view and falling back to the locally-cached
pending file written by the notifier.

## Interface

Registered via `server.tool` ([registration](../../../apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L429)).

- **name**: `lore_list_pending_tasks`
- **description** (verbatim): *"Show pending pipeline tasks that can be claimed
  and run locally. Shows tasks across all repos by default."*

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `repo` | string | no | — | Filter by `owner/repo`. Omit to show all repos. |

## Behavior

1. Read `LORE_API_URL` + `LORE_INGEST_TOKEN` (default `""`).
2. **API path** — when both are set, `GET {apiUrl}/api/tasks?status=pending&limit=50`
   with `Authorization: Bearer {token}`. On a 2xx response:
   1. Take `data.tasks || data || []`.
   2. If `repo` was passed, filter to `t.target_repo === repo`.
   3. If empty → `"No pending tasks for {repo}."` (filtered) or `"No pending tasks."`.
   4. Group remaining tasks by `target_repo` (`"unknown"` when absent). For each
      group emit a `**{repo}** ({count})` header followed by one line per task:
      `"  {id[0:8]} {task_type} {#issue_number? }{description[0:80]}"`. Return the
      sections joined by a blank line.
3. **Local fallback** — when the API is unconfigured or non-2xx, dynamically
   import `listPendingTasks` from `runner.local`
   ([handler](../../../apps/mcp-server/src/features/pipeline/runner.local.ts#L884)), which reads
   `~/.lore/pending-tasks.json` (returning `[]` if missing/unreadable). If empty →
   `"No pending tasks."`. Else emit one block per task:
   `"{id[0:8]} {task_type} {target_repo}{ #issue_number?}\n  {description}"`, joined
   by blank lines. *(Note: the local fallback does **not** apply the `repo` filter.)*
4. Any thrown error → `"Error: {message}"`.

## Output

A single MCP text content block: the grouped API listing, the local-fallback
listing, a "No pending tasks" message, or the error message. Never throws.

## Dependencies & side effects

- `listPendingTasks` (reads `~/.lore/pending-tasks.json`).
- Env: `LORE_API_URL`, `LORE_INGEST_TOKEN`.
- Network: `GET /api/tasks` (API path).

## Acceptance Criteria

`listPendingTasks` returns an array (empty when the cached pending file is
absent). ([validated by `listPendingTasks returns empty array when file is missing`](../../../apps/mcp-server/src/features/pipeline/runner.local.test.ts#L158))

The handler's API-path grouping/formatting, the `repo` filter, and the
local-fallback formatting run only inside the tool. *(untested: the API branch
needs a live `LORE_API_URL`, and the formatting/grouping is inline in the
handler with no extracted seam; the cached-file reader it falls back to is
covered above.)*

## Out of Scope

- Claiming or running a listed task — see `lore_claim_and_run_locally` / `lore_run_task_locally`.
- The notifier that populates `~/.lore/pending-tasks.json` — see [`lore_enable_task_notifications`](../enable-task-notifications/spec.md).
