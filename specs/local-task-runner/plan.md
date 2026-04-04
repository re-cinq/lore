# Implementation Plan: Local Task Runner

## Phase 1: Core — Explicit Local Execution

Get `run_task_locally` working end-to-end. Developer manually triggers,
task runs in background, PR created.

### P1.1 DB Schema
- Add `claimed_by TEXT`, `claimed_at TIMESTAMPTZ` to `pipeline.tasks`
- Add `running-local` as valid status
- `scripts/infra/setup-pipeline-schema.sh` + manual migration

### P1.2 Local Runner Module
- New file: `mcp-server/src/local-runner.ts`
- `spawnLocalTask(taskId, prompt, repo, branch, model)` — creates worktree, spawns claude, returns PID
- `monitorTask(taskId, pid, worktreePath, branch, repo, logFile)` — waits for exit, commits, pushes, creates PR, cleans up
- `cleanupWorktree(taskId)` — removes worktree + PID file
- `listLocalTasks()` — reads `~/.lore/local-tasks.json`
- `cancelLocalTask(taskId)` — kills PID, cleans up
- Uses `~/.lore/worktrees/{task-id}/` for worktrees
- Uses `~/.lore/task-logs/{task-id}.log` for logs
- PID tracked in `~/.lore/worktrees/{task-id}/.lore-task.json`

### P1.3 MCP Tools
- `run_task_locally` — validates args, creates pipeline task via API, calls `spawnLocalTask`, returns task ID
- `list_local_tasks` — reads local task registry, returns running/completed/failed
- `cancel_local_task` — kills process, cleans worktree, updates task status
- All in `mcp-server/src/index.ts` (stdio tools section)

### P1.4 Post-Completion
- On exit 0 with changes: `git add -A && git commit && git push && gh pr create`
- On exit 0 no changes: update task → completed, post result to issue
- On exit non-zero: update task → failed, preserve worktree
- Write logs to GCS (redacted) via API
- Trigger auto-review if repo has `auto_review: true`
- Link PR to GitHub Issue (if webhook-dispatched)

### P1.5 Test
- Run `run_task_locally` on a small task (e.g. "add .editorconfig")
- Verify: worktree created, Claude Code runs, PR created, worktree cleaned up
- Verify: statusline shows local task count

**Deliverable**: Developer can say "run this locally" and get a PR without API cost.

---

## Phase 2: Polling — Auto-Claim Tasks

Local runner polls pipeline and claims tasks before GKE.

### P2.1 GKE Grace Period
- `agent/src/worker.ts` — add 30s delay before claiming pending tasks
- Only claims tasks where `created_at < now() - 30s`
- Local runners claim immediately (no delay)

### P2.2 Task Poller
- `mcp-server/src/local-runner.ts` — add `startPoller(repos, taskTypes, maxConcurrent)`
- Polls every 30s via `setInterval`
- Claims tasks atomically: `UPDATE ... SET status = 'running-local', claimed_by = $1 WHERE status = 'pending' ... FOR UPDATE SKIP LOCKED`
- Respects `max_concurrent` — skips if at limit
- Spawns `spawnLocalTask` for each claimed task

### P2.3 MCP Tools for Polling
- `enable_local_runner` — starts poller, saves config to `~/.lore/local-runner.json`
- `disable_local_runner` — stops poller, removes config

### P2.4 Test
- Create a GitHub Issue with `lore:implementation` label
- Verify: webhook creates task → local runner claims within 30s → implements → PR
- Verify: GKE does NOT pick it up (grace period)

**Deliverable**: Tasks from Issues, UI, and MCP auto-claimed locally.

---

## Phase 3: Resilience & Polish

### P3.1 Stale Task Cleanup
- If PID no longer running and task is `running-local`:
  - If `claimed_at > 30 min ago`: re-queue as `pending` for GKE
  - Clean up orphaned worktrees
- Runs in the poller loop (check every 5 min)

### P3.2 Statusline
- `scripts/lore-statusline.sh` — show local task count
- `scripts/lore-status-cache.sh` — count `~/.lore/worktrees/` entries
- Distinct from GKE tasks: `1 local` vs `1 running`

### P3.3 Config via MCP
- `configure_local_runner` tool — set repos, task_types, max_concurrent, model
- Reads/writes `~/.lore/local-runner.json`

### P3.4 Logging
- Local logs at `~/.lore/task-logs/{task-id}.log`
- Also write to GCS on completion (via API, redacted)
- UI can read from GCS same as GKE tasks

**Deliverable**: Production-ready local runner with failover to GKE.

---

## Execution Order

```
Phase 1: P1.1 → P1.2 → P1.3 → P1.4 → P1.5
Phase 2: P2.1 → P2.2 → P2.3 → P2.4
Phase 3: P3.1 → P3.2 → P3.3 → P3.4
```

Phases 1-2 can be done in one session. Phase 3 is polish.

## Files Changed

| File | Phase | Change |
|------|-------|--------|
| `scripts/infra/setup-pipeline-schema.sh` | P1.1 | Add columns |
| `mcp-server/src/local-runner.ts` | P1.2, P2.2 | New: core module |
| `mcp-server/src/index.ts` | P1.3, P2.3 | Add 5 MCP tools |
| `agent/src/worker.ts` | P2.1 | 30s grace period |
| `scripts/lore-statusline.sh` | P3.2 | Local task count |
| `scripts/lore-status-cache.sh` | P3.2 | Count worktrees |

## Risks

1. **Claude Code stdio conflict** — each background process spawns
   its own MCP server. Tested: works because each Claude Code instance
   is independent. But many concurrent tasks = many MCP server processes.
   Mitigate with `max_concurrent: 2`.

2. **Git worktree race** — if developer rebases main while task runs,
   the worktree may have conflicts. Mitigate: worktrees branch off the
   current HEAD at creation time, not tracking main.

3. **Machine sleep** — tasks die. Mitigate: P3.1 stale cleanup
   re-queues to GKE. Non-blocking for developer.
