# Feature Specification: lore_claim_and_run_locally MCP Tool

| Field   | Value                                       |
|---------|---------------------------------------------|
| Feature | lore_claim_and_run_locally MCP Tool              |
| Status  | Draft                                       |
| Created | 2026-06-10                                  |
| Owner   | Platform Engineering                        |
| Tool    | `lore_claim_and_run_locally`                      |
| Module  | Pipeline (`runner.local.ts`)                |
| Scope   | local                                       |

## Problem Statement

A pending pipeline task surfaced by the notifier should be claimable by a
developer so it runs on their machine (their subscription, zero API cost) instead
of waiting for a GKE agent. `lore_claim_and_run_locally` resolves the pending task
(from the local cache or the API), claims it best-effort, then either runs a
deterministic in-process graph-ingest task or spawns a background worktree task —
and removes it from the local pending list either way.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/local-runner-tools.local.ts#L115)).

- **name**: `lore_claim_and_run_locally`
- **description** (verbatim):

```text
Claims an EXISTING pending pipeline task by id and runs it on your local machine (your Claude subscription), then removes it from the pending list. ingest-* types run in-process with no worktree; all others spawn a background Claude Code worktree task and return task id, branch, log file, and PID. Instead of this: to start a BRAND-NEW task from a description use lore_run_task_locally; to register a task for the GKE agent use lore_create_pipeline_task.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `task_id` | string | yes | — | Id or unique id-prefix of the pending task (from lore_list_pending_tasks); must be in 'pending' status. |
| `model` | string | no | — | Anthropic model id override for non-ingest tasks (e.g. 'claude-opus-4-6'). |

## Behavior

1. **Resolve the task** — search `listPendingTasks()` by exact id or prefix
   ([reader](../../../apps/mcp-server/src/features/pipeline/runner.local.ts#L884)).
   On a miss, when `LORE_API_URL` + `LORE_INGEST_TOKEN` are set, `GET
   /api/task/{task_id}` and adopt it only when its `status === "pending"`.
2. When still unresolved, return `"Task {task_id} not found or not in pending
   status. Run lore_list_pending_tasks first."`.
3. **Claim** — best-effort `POST /api/task` with `action: "claim"` (failures
   ignored).
4. **Dispatch by execution mode** — when `task_type` starts with `"ingest-"`:
   resolve the content source (`resolveContentSource` — cwd tree when it matches,
   else a cached `/tmp` clone), run `executeGraphIngestLocally` in-process (zero
   LLM, no worktree), `skipTask(task.id)`
   ([remover](../../../apps/mcp-server/src/features/pipeline/runner.local.ts#L897)),
   and return the ingest result. A `resolveContentSource` failure returns
   `"Could not prepare repo source for {repo}: {message}"`.
5. **Otherwise** — `spawnLocalTask(...)` (worktree + detached `claude`), then
   `skipTask(task.id)`, and return a "Claimed and running locally" report (Task,
   Branch, Logs, PID).
6. Any thrown error is caught and returned as `"Error: {message}"`.

> **Trust boundary**: registered only in the local MCP server (`*.local.ts`); both
> the worktree spawn and the graph-ingest clone require a trusted sandbox and are
> never wired into the shared GKE server.

## Output

A single MCP text content block: the not-found message, the source-prep error,
the ingest result, the "Claimed and running locally" report, or `"Error: …"`.
**Never throws**.

## Dependencies & side effects

- `listPendingTasks()`, `skipTask()` (read/rewrite `~/.lore/pending-tasks.json`).
- `spawnLocalTask` (git worktree + detached `claude`) for non-ingest tasks.
- `resolveContentSource` / `executeGraphIngestLocally` (graph-ingest path,
  in-process; may clone to `/tmp`).
- Env: `LORE_API_URL`, `LORE_INGEST_TOKEN` (task fetch + claim, best-effort).

## Acceptance Criteria

`skipTask` removes a task from the pending list by id, leaving the rest.
([validated by `skipTask filters a task by id from the pending file`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L169))

`listPendingTasks` returns an array (empty when the backing file is absent).
([validated by `listPendingTasks returns empty array when file is missing`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L161))

`validateRepoMatch` (invoked inside `spawnLocalTask`) throws on a cwd/target-repo
mismatch. ([validated by `throws when cwd repo differs from task repo`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L227))

The full claim flow (API fetch, claim POST, ingest dispatch, worktree spawn) is
exercised only end-to-end. *(untested: the orchestration depends on network
`fetch`, `spawnLocalTask`'s child processes, and the graph-ingest clone — no IO
seam to substitute without mocks, which the no-mocks convention forbids. The pure
pending-list helpers it leans on are covered above.)*

## Out of Scope

- The notifier loop that populates the pending list (`startNotifier`).
- Test/spec-trace projection — now CI-driven (ADR-023), no longer a local task.
- Starting an ad-hoc task — [`lore_run_task_locally`](../run-task-locally/spec.md).
