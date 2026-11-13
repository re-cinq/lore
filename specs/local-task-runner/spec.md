# Feature Specification: Local Task Runner

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | Local Task Runner                        |
| Status         | In Progress                              |
| Created        | 2026-04-04                               |
| Owner          | Platform Engineering                     |

Local Task Runner runs Lore pipeline tasks inside the developer's own Claude Code session and an isolated git worktree, started by explicit invocation or by an explicit claim of a pending task, so subscription holders spend included usage instead of Anthropic API credits and skip the fresh-clone overhead of a GKE pod.

## Problem Statement

Every Lore task runs on GKE as an ephemeral Job pod, using Anthropic
API credits. For developers with Claude Code Pro/Max subscriptions,
this is wasteful — their subscription includes unlimited usage that
could run the same tasks for free.

Additionally, GKE tasks clone the repo from scratch (~30s overhead),
while the developer already has the repo locally.

## Solution

A local task runner that runs inside the developer's Claude Code
session. It works in two modes:

1. **Explicit** — developer calls `lore_run_task_locally` to spawn a task
2. **Notify and claim**: `lore_enable_task_notifications` starts a notifier
   that lists pending tasks, and the developer runs one with
   `lore_claim_and_run_locally`. Nothing is claimed automatically
   *(amended 2026-11-13: this replaced the opt-in poller that claimed tasks itself)*

Both modes spawn a background Claude Code process in an isolated git
worktree on the developer's machine, using their subscription.

### User Experience

#### Mode 1: Explicit (developer triggers)

```
Developer: "run this locally: add rate limiting to the API endpoint"

Claude Code:
  → Calls lore_run_task_locally
  → Creates git worktree
  → Spawns background Claude Code
  → Returns immediately

Statusline: ◉ Lore 1 local · auto-review · 36 memories
```

#### Mode 2: Notify and claim (developer opts in)

```
Developer: "tell me about new tasks for this repo"

Claude Code:
  → Calls lore_enable_task_notifications
  → MCP server reads the repo's pending tasks every 30s
  → Writes them to ~/.lore/pending-tasks.json, claims nothing

Statusline shows the pending count

Developer: "run that one locally"

Claude Code:
  → Calls lore_claim_and_run_locally(task_id)
  → Spawns background Claude Code in a worktree
  → Removes the task from the pending list
  → PR created, auto-review triggered
  → All on developer's subscription, zero API cost
```

### Architecture

```
Developer's machine
├── Claude Code (main session — developer working)
│   └── Lore MCP Server (stdio)
│       ├── lore_run_task_locally            → explicit trigger
│       ├── lore_enable_task_notifications   → start the notifier
│       ├── lore_disable_task_notifications  → stop the notifier
│       ├── lore_list_pending_tasks          → show what can be claimed
│       ├── lore_claim_and_run_locally       → claim one pending task, run it
│       ├── lore_skip_task                   → dismiss one notification
│       ├── lore_configure_local_runner      → edit local-runner.json
│       ├── lore_list_local_tasks            → show running/completed
│       ├── lore_cancel_local_task           → kill + cleanup
│       └── Task notifier (background, 30s interval)
│           └── Lists pending tasks, claims nothing
│
├── Background worker 1 (worktree A)
│   └── claude --print --dangerously-skip-permissions
│       └── Has own MCP server instance (stdio)
│
├── Background worker 2 (worktree B)
│   └── claude --print --dangerously-skip-permissions
│       └── Has own MCP server instance (stdio)
│
└── ~/.lore/
    ├── worktrees/{task-id}/        (git worktrees)
    ├── task-logs/{task-id}.log     (stdout/stderr)
    ├── local-runner.json           (config: enabled, max_concurrent)
    ├── pending-tasks.json          (the notifier's list of pending tasks)
    └── local-tasks.json            (task registry, the only copy of task metadata)
```

### Task Claiming

Nothing is claimed automatically. `lore_enable_task_notifications` starts a notifier in the MCP server that reads the pending tasks of the watched repos every 30 seconds and writes them to `~/.lore/pending-tasks.json`, which the statusline reads and `lore_list_pending_tasks` falls back to when the API is unreachable; `lore_disable_task_notifications` stops it and removes the file. *(amended 2026-11-13: the notifier replaced the poller that claimed tasks itself with `FOR UPDATE SKIP LOCKED`, and the worker whose 30 second grace period gave local runners priority was deleted on 2026-10-02.)* ([validated by watches re-cinq/lore for runbook and gap-fill tasks by default @f4cb39e5](apps/mcp-server/src/transport/tools/pipeline/enable-task-notifications.test.ts#L33), [validated by stops a running notifier and removes its pending cache @e31ecfc0](apps/mcp-server/src/transport/tools/pipeline/disable-task-notifications.test.ts#L23))

`lore_claim_and_run_locally` takes one pending task by its id or id prefix, posts a best-effort claim to `POST /api/task`, starts the run and removes the task from the pending list. A task that is neither in the pending list nor pending in the API is answered as not found. ([validated by runs the cached task by its id prefix and takes it off the pending list @ae83d0b2](apps/mcp-server/src/transport/tools/local-runner/claim-and-run-locally.local.test.ts#L49), [validated by answers not found when neither the pending cache nor the API knows task c0ffee00 @fbe95585](apps/mcp-server/src/transport/tools/local-runner/claim-and-run-locally.local.test.ts#L41))

### Execution Flow

```
Task started (lore_run_task_locally or lore_claim_and_run_locally)
  │
  ├── 1. Create git worktree
  │     git worktree add ~/.lore/worktrees/{task-id} -b {branch}
  │
  ├── 2. Spawn background Claude Code
  │     claude --print \
  │       --dangerously-skip-permissions \
  │       --model claude-sonnet-4-6 \
  │       --cwd ~/.lore/worktrees/{task-id} \
  │       -- "{lore workflow preamble}\n{task prompt}"
  │     
  │     stdout/stderr → ~/.lore/task-logs/{task-id}.log
  │
  ├── 3. Record task metadata
  │     ~/.lore/local-tasks.json, never a file inside the worktree
  │     { taskId, pid, branch, repo, worktreePath, logFile, startedAt, status }
  │
  ├── 4. Return to developer (non-blocking)
  │
  ├── 5. Background: wait for process to exit
  │
  ├── 6. On success (exit 0):
  │     ├── git add + commit + push
  │     ├── Create PR via gh CLI
  │     ├── Update task: status → pr-created
  │     ├── Write logs to GCS (redacted)
  │     ├── Clean up worktree
  │     ├── Trigger auto-review if enabled
  │     └── Comment on issue: "PR created: #N"
  │
  ├── 7. On success (no changes):
  │     ├── Update task: status → completed
  │     ├── Post result as issue comment (general tasks)
  │     └── Clean up worktree
  │
  └── 8. On failure:
        ├── Update task: status → failed
        ├── Preserve worktree for debugging
        ├── Comment on issue: "Task failed: {error}"
        └── Write failure logs to GCS
```

### MCP Server Access

Each spawned Claude Code process gets its own Lore MCP server
instance automatically — the MCP server is configured in
`~/.claude/settings.json` as a stdio command. Claude Code spawns a
new MCP server child process per session. No conflicts.

This means background tasks have full access to:
- `lore_assemble_context` — load conventions and ADRs
- `lore_search_memory` — check for prior solutions
- `lore_write_episode` — record learnings
- `lore_query_graph` — explore entity relationships

The Lore workflow preamble ensures they follow the same protocol.

### Task Sources

All task sources feed into the same pipeline, and a pending task can
be claimed locally with `lore_claim_and_run_locally`:

| Source | How task arrives | Local runner claims? |
|--------|-----------------|---------------------|
| GitHub Issue (label dispatch) | Webhook → pending | On explicit claim |
| Lore UI "New Task" | API → pending | On explicit claim |
| `lore_create_pipeline_task` MCP tool | API → pending | On explicit claim |
| `lore_run_task_locally` MCP tool | Direct → running-local | Always local |
| Auto-review (watcher) | Watcher → pending | On explicit claim |
| Feature request (PM) | UI → pending | No (uses feature-request handler) |

### Concurrency & Limits

- **Max concurrent**: 2 (configurable in `~/.lore/local-runner.json`)
- **Isolation**: each task gets its own git worktree
- **Developer's session**: unaffected — worktrees are separate
- **Machine sleep**: in-progress tasks are killed. Cleanup job detects
  stale tasks (no PID running) and re-queues them as `pending` for GKE

### Statusline Integration

```bash
# Count local running tasks
LOCAL=$(ls ~/.lore/worktrees/ 2>/dev/null | wc -l | tr -d ' ')
[ "$LOCAL" -gt 0 ] && PARTS="${CYAN}${LOCAL} local${RESET}"
```

Shows: `◉ Lore 1 local · 1 PR ready · auto-review · 36 memories`

### Configuration

`~/.lore/local-runner.json`:
```json
{
  "enabled": false,
  "max_concurrent": 2,
  "repos": ["re-cinq/lore", "re-cinq/re-plan"],
  "task_types": ["implementation", "general", "runbook", "gap-fill"],
  "model": "claude-sonnet-4-6"
}
```

- `enabled` — whether polling is active
- `repos` — which repos to claim tasks for (empty = current repo only)
- `task_types` — which types to claim (skip feature-request, onboard)
- `model` — default model for local tasks

### DB Changes

Add to `pipeline.tasks`:
```sql
ALTER TABLE pipeline.tasks ADD COLUMN claimed_by TEXT;
ALTER TABLE pipeline.tasks ADD COLUMN claimed_at TIMESTAMPTZ;
```

Add `running-local` as a valid status value.

### File Changes

| File | Change |
|------|--------|
| `apps/mcp-server/src/work/pipeline/runner-local-*.ts` | Worktree management, process spawning, the notifier, monitoring |
| `apps/mcp-server/src/transport/tools/local-runner/` | Tools: lore_run_task_locally, lore_claim_and_run_locally, lore_configure_local_runner, lore_list_local_tasks, lore_cancel_local_task |
| `apps/mcp-server/src/transport/tools/pipeline/` | Tools: lore_enable_task_notifications, lore_disable_task_notifications, lore_list_pending_tasks, lore_skip_task |
| `scripts/lore-statusline.sh` | Show local task count |
| `scripts/lore-status-cache.sh` | Count local worktrees |
| `scripts/infra/setup-pipeline-schema.sh` | Add claimed_by, claimed_at columns |

### Security

- Local tasks run with the developer's permissions (not elevated)
- PR creation uses `gh` CLI (developer's GitHub auth)
- Logs go to GCS via the API (redacted, same as GKE)
- Worktrees are in `~/.lore/` (not in the main repo)
- No secrets from the GKE cluster are accessed locally

### Limitations

1. **Machine must be on** — if developer closes laptop, tasks fail.
   Stale task cleanup re-queues to GKE after 30 min.
2. **No MCP server on GKE** — auto-review tasks from the watcher still
   run on GKE (they need the K8s API to create LoreTask CRs). Local
   runner only handles the initial implementation/general tasks.
3. **Git worktree sharing** — worktrees share `.git`. Avoid force
   pushes or rebases on main while tasks run.
4. **Rate limits** — Pro/Max subscription may have usage limits. The
   runner respects max_concurrent to avoid overload.

## Acceptance Criteria

1. `lore_run_task_locally` spawns background Claude Code in a worktree
2. Developer's main session continues uninterrupted
3. `lore_claim_and_run_locally` runs the pending task the developer names and takes it off the pending list ([validated by runs the cached task by its id prefix and takes it off the pending list @ae83d0b2](apps/mcp-server/src/transport/tools/local-runner/claim-and-run-locally.local.test.ts#L49))

4. `lore_enable_task_notifications` lists the watched repos' pending tasks without claiming any ([validated by watches re-cinq/lore for runbook and gap-fill tasks by default @f4cb39e5](apps/mcp-server/src/transport/tools/pipeline/enable-task-notifications.test.ts#L33))
5. Background task commits, pushes, creates PR on completion
6. Logs stored locally and in GCS (redacted)
7. Statusline shows local task count
8. `lore_cancel_local_task` kills process and cleans up worktree
9. Failed tasks preserve worktree for debugging
10. No API credits consumed (uses Claude Code subscription)
11. Auto-review triggers on GKE after local PR creation
12. Stale tasks (machine offline) re-queued to GKE after 30 min
