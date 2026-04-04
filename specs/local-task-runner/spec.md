# Feature Specification: Local Task Runner

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | Local Task Runner                        |
| Status         | Shipped                                  |
| Created        | 2026-04-04                               |
| Owner          | Platform Engineering                     |

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

1. **Explicit** — developer calls `run_task_locally` to spawn a task
2. **Polling** — local runner claims tasks from the pipeline before
   GKE picks them up (opt-in)

Both modes spawn a background Claude Code process in an isolated git
worktree on the developer's machine, using their subscription.

### User Experience

#### Mode 1: Explicit (developer triggers)

```
Developer: "run this locally: add rate limiting to the API endpoint"

Claude Code:
  → Calls run_task_locally
  → Creates git worktree
  → Spawns background Claude Code
  → Returns immediately

Statusline: ◉ Lore 1 local · auto-review · 36 memories
```

#### Mode 2: Polling (developer opts in)

```
Developer: "start picking up tasks locally for this repo"

Claude Code:
  → Calls enable_local_runner
  → MCP server starts polling pipeline.tasks every 30s
  → Claims pending tasks for this repo
  → Spawns background Claude Code for each

PM creates Issue with "lore:implementation" label
  → Webhook creates pipeline task (status: pending)
  → Local runner claims it within 30s
  → Background Claude Code implements
  → PR created, auto-review triggered
  → All on developer's subscription, zero API cost
```

### Architecture

```
Developer's machine
├── Claude Code (main session — developer working)
│   └── Lore MCP Server (stdio)
│       ├── run_task_locally     → explicit trigger
│       ├── enable_local_runner  → start polling
│       ├── disable_local_runner → stop polling
│       ├── list_local_tasks     → show running/completed
│       ├── cancel_local_task    → kill + cleanup
│       └── Task poller (background, 30s interval)
│           └── Claims pending tasks → spawns workers
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
    └── local-tasks.json            (running task registry)
```

### Task Claiming

When polling is enabled, the local runner claims tasks atomically:

```sql
UPDATE pipeline.tasks
SET status = 'running-local',
    claimed_by = $1,              -- agent ID
    claimed_at = now()
WHERE id = (
  SELECT id FROM pipeline.tasks
  WHERE status = 'pending'
    AND target_repo = $2          -- current repo
    AND task_type IN ('implementation', 'general', 'runbook', 'gap-fill', 'review')
    AND claimed_by IS NULL
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

GKE's agent worker uses the same query but with `status = 'pending'`.
The `FOR UPDATE SKIP LOCKED` ensures only one runner claims each task.

**Grace period**: GKE worker waits 30s before claiming pending tasks.
Local runners claim immediately. This gives local runners priority.

### Execution Flow

```
Task claimed (from poll or explicit run_task_locally)
  │
  ├── 1. Create git worktree
  │     git worktree add ~/.lore/worktrees/{task-id} -b {branch}
  │
  ├── 2. Write task metadata
  │     ~/.lore/worktrees/{task-id}/.lore-task.json
  │     { taskId, pid, branch, repo, startedAt }
  │
  ├── 3. Spawn background Claude Code
  │     claude --print \
  │       --dangerously-skip-permissions \
  │       --model claude-sonnet-4-6 \
  │       --cwd ~/.lore/worktrees/{task-id} \
  │       -- "{lore workflow preamble}\n{task prompt}"
  │     
  │     stdout/stderr → ~/.lore/task-logs/{task-id}.log
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
- `assemble_context` — load conventions and ADRs
- `search_memory` — check for prior solutions
- `write_episode` — record learnings
- `query_graph` — explore entity relationships

The Lore workflow preamble ensures they follow the same protocol.

### Task Sources

All task sources feed into the same pipeline and can be claimed
locally:

| Source | How task arrives | Local runner claims? |
|--------|-----------------|---------------------|
| GitHub Issue (label dispatch) | Webhook → pending | Yes (if polling enabled) |
| Lore UI "New Task" | API → pending | Yes (if polling enabled) |
| `create_pipeline_task` MCP tool | API → pending | Yes (if polling enabled) |
| `run_task_locally` MCP tool | Direct → running-local | Always local |
| Auto-review (watcher) | Watcher → pending | Yes (if polling enabled) |
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

### GKE Worker Changes

The GKE worker needs a 30s grace period before claiming tasks, giving
local runners priority:

```typescript
// In worker.ts claimNextTask()
const task = await query(
  `SELECT * FROM pipeline.tasks
   WHERE status = 'pending'
     AND (claimed_by IS NULL)
     AND created_at < now() - interval '30 seconds'
   ORDER BY created_at ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED`,
);
```

### File Changes

| File | Change |
|------|--------|
| `mcp-server/src/local-runner.ts` | New: worktree management, process spawning, polling, monitoring |
| `mcp-server/src/index.ts` | Add 5 tools: run_task_locally, enable_local_runner, disable_local_runner, list_local_tasks, cancel_local_task |
| `agent/src/worker.ts` | Add 30s grace period before claiming tasks |
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

1. `run_task_locally` spawns background Claude Code in a worktree
2. Developer's main session continues uninterrupted
3. Polling mode claims pending tasks before GKE (30s priority window)
4. Tasks from GitHub Issues work through local runner when polling
5. Background task commits, pushes, creates PR on completion
6. Logs stored locally and in GCS (redacted)
7. Statusline shows local task count
8. `cancel_local_task` kills process and cleans up worktree
9. Failed tasks preserve worktree for debugging
10. No API credits consumed (uses Claude Code subscription)
11. Auto-review triggers on GKE after local PR creation
12. Stale tasks (machine offline) re-queued to GKE after 30 min
