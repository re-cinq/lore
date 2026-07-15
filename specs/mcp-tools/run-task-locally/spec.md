# Feature Specification: lore_run_task_locally MCP Tool

| Field   | Value                                       |
|---------|---------------------------------------------|
| Feature | lore_run_task_locally MCP Tool                   |
| Status  | **Draft**                                   |
| Created | 2026-06-10                                  |
| Owner   | Platform Engineering                        |
| Tool    | `lore_run_task_locally`                          |
| Module  | Pipeline (`runner.local.ts`)                |
| Scope   | local                                       |

## Problem Statement

A developer wants to delegate an implementation task to a background Claude Code
process that runs on their own machine, on their subscription (zero API cost),
without blocking the interactive session. `lore_run_task_locally` creates an isolated
git worktree on a fresh branch, spawns a detached headless `claude --print` in
it, and returns immediately with the task id, branch, worktree path, log file,
and PID — the session continues while the task runs and eventually opens a PR.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/local-runner-tools.local.ts#L7)).

- **name**: `lore_run_task_locally`
- **description** (verbatim):

```text
Starts a brand-new ad-hoc task as a detached background Claude Code process in a local git worktree; returns immediately with task id, branch, worktree path, log file, and PID. Runs on your local machine (your Claude subscription). Instead of this: to run an EXISTING pending pipeline task by id use lore_claim_and_run_locally; to register a task for the GKE agent use lore_create_pipeline_task.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `description` | string | yes | — | Free-text instruction for the agent. Must reference the current repo; cross-repo references are refused with a wrong-repo warning. |
| `task_type` | enum | no | `"implementation"` | Kind of work: 'implementation' (code), 'general' (open-ended), 'runbook' (incident runbook), 'gap-fill' (missing docs). |
| `model` | string | no | — | Anthropic model id override for the spawned process (e.g. 'claude-opus-4-6'). |

## Behavior

1. Resolve the current repo via `detectRepo()` (parses `git remote get-url origin`).
   When null, return `"Error: not in a git repository with a GitHub remote"`.
2. **Wrong-repo guard** — if the `description` references an `owner/repo` token
   that differs from the detected repo and does not mention the detected repo,
   return a `"Warning: This task references … but you're in …"` message with a
   `cd` suggestion — no worktree is created.
3. **Task id** — generate a UUID. When `LORE_API_URL` + `LORE_INGEST_TOKEN` are
   set, `POST {apiUrl}/api/task` to register the task and adopt the returned
   `task_id`; any failure falls back to the generated UUID.
4. Spawn via `spawnLocalTask({taskId, prompt, repo, taskType, model, repoRoot})`
   ([spawn](../../../apps/mcp-server/src/features/pipeline/runner.local.ts#L450)):
   1. `ensureDirs()` for `~/.lore/worktrees` and `~/.lore/task-logs`.
   2. `validateRepoMatch(repo, detectRepo())`
      ([guard](../../../apps/mcp-server/src/features/pipeline/runner.local.ts#L150)) —
      throws if the cwd is a checkout of a different repo than `target_repo`.
   3. Build branch `lore/<taskType>/<slug>-<shortId>`; refuse if the worktree dir
      already exists (idempotency).
   4. `git worktree add` the branch; pre-hydrate context from `/api/context`
      (best effort); spawn detached `claude --print --dangerously-skip-permissions
      --model <model> -- <prompt>` with stdio to the log file; `unref()`.
   5. Register the task in `~/.lore/local-tasks.json` (never inside the worktree)
      and start `monitorTask` in the background (validate → commit → push → PR).
5. Return a text block reporting Task ID, Branch, Worktree, Logs, and PID.
6. Any thrown error is caught and returned as `"Error: {message}"`.

> **Note**: this tool's registration closure does **not** itself call
> `executionRefusal`; the trust boundary is enforced structurally — the tool is
> registered only in a `*.local.ts` module wired into the local MCP server, and
> the spawn path shells out to `git`/`claude` which are absent on the shared
> server. The sibling spec-trace tools gate explicitly via `executionRefusal`.

## Output

A single MCP text content block: the success report, the not-in-a-repo error, the
wrong-repo warning, or `"Error: {message}"`. **Never throws**.

## Dependencies & side effects

- `detectRepo()`, `getRepoRoot()`, `spawnLocalTask` (all shell out to `git`).
- Spawns a detached `claude` process; creates a git worktree + branch.
- Writes `~/.lore/local-tasks.json`; appends to a per-task log file.
- Env: `LORE_API_URL`, `LORE_INGEST_TOKEN` (task registration + context hydration,
  both best-effort).
- `monitorTask` later runs validation, `git commit`/`push`, and `gh pr create`.

## Acceptance Criteria

`validateRepoMatch` passes when the cwd repo matches the task's target repo.
([validated by `passes when cwd repo matches task repo`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L227))

`validateRepoMatch` throws when the cwd repo differs from the task's target repo.
([validated by `throws when cwd repo differs from task repo`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L227))

The repo-mismatch error names both repos and suggests a `cd`.
([validated by `error message names both repos and suggests a cd`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L233))

`validateRepoMatch` passes when the cwd repo cannot be detected (null).
([validated by `passes when cwd repo cannot be detected (null)`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L250))

The spawned branch follows the `lore/<type>/<slug>-<shortId>` format.
([validated by `creates lore/<type>/<slug>-<shortId> format`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L200))

A short prompt still produces a valid branch name.
([validated by `handles very short prompts`](apps/mcp-server/src/features/pipeline/runner.local.test.ts#L214))

The end-to-end spawn (worktree creation, `claude` process, `monitorTask` →
commit/push/PR) is exercised only by manual / integration runs. *(untested:
`spawnLocalTask` forks `git worktree add` and a detached `claude` process and
mutates `~/.lore` at a module-load-fixed path — no IO seam to substitute without
mocking child_process, which the no-mocks convention forbids.)*

## Out of Scope

- Claiming a pre-existing pending task — owned by [`lore_claim_and_run_locally`](../claim-and-run-locally/spec.md).
- Listing / cancelling tasks — [`lore_list_local_tasks`](../list-local-tasks/spec.md),
  [`lore_cancel_local_task`](../cancel-local-task/spec.md).
- Deterministic validation internals (`repo-validation.ts`).
