# Feature Specification: lore_list_pending_tasks MCP Tool

| Field   | Value                                          |
|---------|------------------------------------------------|
| Feature | lore_list_pending_tasks MCP Tool                    |
| Status  | In Progress                                    |
| Created | 2026-06-10                                     |
| Owner   | Platform Engineering                           |
| Tool    | `lore_list_pending_tasks`                           |
| Module  | Pipeline (`features/pipeline/runner.local.ts`) |
| Scope   | local                                          |

`lore_list_pending_tasks` shows unclaimed backlog pipeline tasks grouped by repo so a developer can pick one to run locally before the GKE agent claims it.

## Problem Statement

A developer running Claude Code locally wants to see backlog pipeline tasks they
could claim and run on their own machine (zero API cost) before the GKE agent
picks them up. `lore_list_pending_tasks` shows pending tasks across all repos by
default, preferring a live API view and falling back to the locally-cached
pending file written by the notifier.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L429)).

- **name**: `lore_list_pending_tasks`
- **description** (verbatim):

```text
Shows unclaimed 'pending' backlog tasks grouped by repo — the 'what can I grab' view. Falls back to ~/.lore/pending-tasks.json (local notifier cache) when the API is unreachable; the repo filter applies on both paths. After choosing one, run it with lore_claim_and_run_locally. Instead: lore_list_pipeline_tasks for a general status-filterable listing; lore_ready_tasks for dependency-ready spec-tasks in one repo.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `repo` | string | no | — | `owner/repo` filter for the API view. Omit for all repos. |

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
   `~/.lore/pending-tasks.json` (returning `[]` if missing/unreadable). When `repo`
   was passed, filter to `t.target_repo === repo` (same as the API path). If empty →
   `"No pending tasks for {repo}."` (filtered) or `"No pending tasks."`. Else emit one
   block per task: `"{id[0:8]} {task_type} {target_repo}{ #issue_number?}\n  {description}"`,
   joined by blank lines.
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
absent). ([validated by `runner.local.test.ts:142`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L142))

The local-fallback path applies the `repo` filter, returns the repo-scoped empty
message when nothing matches, and lists all repos when no filter is given.
([validated by `returns only the matching repo's tasks`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L76), [validated by `returns the repo-scoped empty message when nothing matches`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L86), [validated by `returns all repos when no filter is given`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L94))

The API-path grouping/formatting runs only inside the tool. *(untested: the API
branch needs a live `LORE_API_URL` and the formatting/grouping is inline in the
handler with no extracted seam.)*

## Out of Scope

- Claiming or running a listed task — see `lore_claim_and_run_locally` / `lore_run_task_locally`.
- The notifier that populates `~/.lore/pending-tasks.json` — see [`lore_enable_task_notifications`](../enable-task-notifications/spec.md).
