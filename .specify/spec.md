# Feature Specification: LoreTask CRD — Ephemeral Claude Code Execution

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | LoreTask CRD + Controller                |
| Branch         | feat/loretask-crd                        |
| Status         | Shipped                                  |
| Created        | 2026-04-01                               |
| Last Updated   | 2026-04-06                               |
| Owner          | Platform Engineering                     |

## Problem Statement

Implementation tasks run `claude --print` inside the long-lived agent
pod. This is fundamentally broken:

1. **CI deploys kill running tasks** — Every push to main triggers
   `build-agent.yml` → deploy → `kubectl rollout restart`, which
   terminates the pod while Claude Code is mid-execution. Tasks go
   `pending` → `running` → orphaned.
2. **No parallelism** — The worker is single-threaded. One Claude Code
   session blocks the entire agent for 5-15 minutes.
3. **No isolation** — A runaway Claude Code session can OOM the agent
   pod, taking down task polling, schedulers, and health checks.
4. **No observability** — Claude Code stdout/stderr is lost when the
   pod restarts. No way to stream progress to the UI.

## Solution: LoreTask CRD + Controller

Replace in-process `spawn("claude")` with a Kubernetes-native pattern:

```
Agent Worker                    K8s API                     Job Pod
─────────────                   ───────                     ─────────
detects pending task ──────►  creates LoreTask CR
                              controller watches ──────►  creates Job
                                                          clone repo
                                                          hydrate context
                                                          claude --print ...
                                                          validate (lint/typecheck)
                                                          git add/commit/push
                              Job completes ◄──────────   exit 0
controller reads Job logs ◄─  updates LoreTask status
loretask-watcher polls ────►  creates PR, updates DB
                              writes episode, posts Slack
```

## CRD: `LoreTask`

```yaml
apiVersion: lore.re-cinq.com/v1alpha1
kind: LoreTask
metadata:
  name: loretask-{task-id-short}
  namespace: lore-agent
  labels:
    lore.re-cinq.com/task-id: {full-uuid}
    lore.re-cinq.com/task-type: implementation|review
spec:
  taskId: {uuid}                    # pipeline.tasks.id
  taskType: implementation|review|general  # from task-types.yaml
  description: "..."                # task description
  prompt: "..."                     # full rendered prompt
  targetRepo: "re-cinq/lore"       # owner/repo
  branch: "lore/impl/..."          # branch to create (implementation)
  prNumber: 42                      # PR to review (review tasks only)
  model: "claude-sonnet-4-6"       # Claude Code model
  timeoutMinutes: 30               # max Job duration
  image: "ghcr.io/re-cinq/lore-claude-runner:latest"
status:
  phase: Pending | Running | Succeeded | Failed
  jobName: ""                       # created Job name
  startedAt: null
  completedAt: null
  exitCode: null
  output: ""                        # Claude Code stdout (last 5000 chars)
  changedFiles: 0
  prUrl: ""                         # set after PR creation; "no-changes" for general tasks
  prNumber: 0
  reviewResult: "approved|changes-requested"  # review tasks only
  parentTaskId: ""                  # review tasks only — links to impl task
  failureReason: ""
  logUrl: ""                        # gs://{LORE_LOG_BUCKET}/{repo}/{taskId}/output.log
```

## Controller (`agent/src/loretask-controller.ts`)

Polls every 15 seconds. For each `phase: Pending` LoreTask:

1. **Creates a per-task GitHub token Secret** — calls
   `GitHubPlatform.getInstallationToken()` and stores as
   `loretask-github-token-{taskIdShort}`. Short-lived; deleted after
   Job completes. On 409 (pre-existing), deletes and recreates.
2. **Creates a Job** with the claude-runner image:
   - Env: `TARGET_REPO`, `BRANCH_NAME`, `TASK_PROMPT`, `MODEL`,
     `TASK_TYPE`, `PR_NUMBER`, `ANTHROPIC_API_KEY`, `LORE_API_URL`,
     `LORE_INGEST_TOKEN`
   - GitHub token from the per-task Secret (not shared agent secret)
   - Resources: 1 CPU, 2Gi memory
   - `activeDeadlineSeconds`: `timeoutMinutes * 60`
   - `ttlSecondsAfterFinished: 300` (auto-delete pod)
   - `backoffLimit: 1` (allow one restart on pod failure)
3. **Monitors** the Job: updates `phase` on completion/failure
4. **On success**: reads Job pod logs, stores to GCS, extracts
   `changedFiles` count, captures `reviewResult` (review tasks),
   sets `phase: Succeeded`
5. **On failure**: captures stderr, sets `phase: Failed` with reason
6. **Deletes token Secret** after Job completes (success or failure)

## Claude Runner Image (`docker/claude-runner/`)

Base: `node:24-slim` + `git` + `curl` + `jq` + `gh` CLI + `claude` CLI
(installed via `npm install -g @anthropic-ai/claude-code`).

Validation CLI (`/validation.js`) is compiled from
`docker/claude-runner/validation/` during image build — provides
deterministic lint/typecheck detection for Node/Go/Python/Rust.
Non-root `runner` user.

### Implementation flow (`TASK_TYPE != review`)

```
1. Validate required env vars
2. git clone --depth=1 + checkout branch
3. Pre-run context hydration (if LORE_API_URL + LORE_INGEST_TOKEN set):
   - GET /api/context?repo=&template=implementation&query=...
   - Prepends assembled context (conventions, ADRs, memories) to prompt
4. Run claude --print --dangerously-skip-permissions
5. Check for changes (git status --porcelain)
   - No changes + TASK_TYPE=general → exit 0
   - No changes + other type → exit 1 (NO_CHANGES printed)
6. Deterministic validation: node /validation.js --quick --repo . --files {changed}
   - On failure: spawn one fix pass with error output, re-validate
   - Still failing: print NEEDS_HUMAN_HELP, continue to commit
7. git add -A && git commit -m "lore: {TASK_TYPE} — {branch-slug}"
8. git push origin {BRANCH_NAME}
9. Print CHANGES={count}
```

### Review flow (`TASK_TYPE=review`)

```
1. Validate: GITHUB_TOKEN, TARGET_REPO, PR_NUMBER, TASK_PROMPT
2. git clone + gh pr checkout {PR_NUMBER}
3. Prepend review preamble (lore_assemble_context with template=review,
   lore_search_memory for patterns)
4. Run claude --print → full output captured
5. Parse structured result from output:
   - REVIEW_RESULT:APPROVED or REVIEW_APPROVED → result="approved"
   - REVIEW_RESULT:CHANGES_REQUESTED:<msg> → result="changes-requested"
   - No match → treat as changes-requested (last 500 chars as feedback)
6. Write /tmp/review-result.txt
7. Print REVIEW_RESULT:{result}
```

## Watcher Job (`agent/src/jobs/loretask-watcher.ts`)

Scheduled every 15s. Processes completed LoreTasks:

### Implementation task succeeded (changedFiles > 0)

1. `platform().createPR(targetRepo, branch, title, body)`
2. Update `pipeline.tasks` → `status=pr-created`, `pr_url`, `pr_number`
3. Set `log_url = gs://{LORE_LOG_BUCKET}/{repo}/{taskId}/output.log`
4. Comment on GitHub Issue + close it
5. Patch LoreTask CR `status.prUrl` + `status.prNumber`
6. Post PR link to Slack (originating `slack_channel_id` or repo-mapped)
7. `writeEpisodeWithCuration(...)` — auto-captures outcome for memory
8. If `lore.repos.settings.auto_review = true`:
   - Insert review task in `pipeline.tasks`
   - Create review LoreTask CR with `taskType=review`, `prNumber`
   - Update impl task status → `review`

### Implementation task succeeded (changedFiles = 0, general tasks)

1. Create GitHub Issue with Claude output as body (if no existing issue)
   OR comment result on existing issue
2. Update `pipeline.tasks` → `status=completed`
3. Patch LoreTask CR `status.prUrl = "no-changes"`
4. Post to Slack if applicable
5. `writeEpisode(...)` — auto-captures outcome

### Implementation task failed

1. Update `pipeline.tasks` → `status=failed`, `failure_reason`
2. Comment failure on GitHub Issue + add `lore-failed` label
3. Post failure message to Slack
4. `writeEpisodeWithCuration(...)` — lesson extraction via Haiku

### Review task succeeded

1. If `reviewResult = "approved"`:
   - Update parent impl task → `status=completed`
   - Comment "approved, ready for human merge" on Issue
2. If `reviewResult = "changes-requested"`:
   - Increment `review_iteration` on parent task
   - If iteration < 2: create new impl LoreTask CR on same branch with
     feedback in prompt
   - If iteration >= 2: set parent status → `review` (escalate),
     add `needs-human-review` label to Issue

### Cleanup

Delete LoreTask CRs older than 1 hour that are Succeeded (with
`prUrl` set or `changedFiles=0`) or Failed. Also delete orphaned
`loretask-github-token-{taskIdShort}` Secrets.

## GitHub Issues Integration

Every pipeline task gets a GitHub Issue on the target repo:

- Created by the worker before the LoreTask CR is submitted, labeled
  `lore-managed` + `{taskType}`
- Progress comments added by the watcher (PR link, failures)
- Closed (state=completed) when PR is created
- `lore-failed` label added on failure
- `needs-human-review` label added on review escalation

For `general`/research tasks that produce no code: issue is created
with the Claude output as the body (not closed — it is the deliverable).

## Slack Integration

Watcher posts messages via `chat.postMessage` using `LORE_SLACK_BOT_TOKEN`.
Channel resolved in order:
1. `pipeline.tasks.context_bundle.slack_channel_id` (task originated
   from Slack `/lore` command)
2. `lore.repos.settings.slack_channel_id` (repo-level default)

Messages:
- PR created → `"PR ready for review: {url}"`
- Task failed → `"Task failed on {repo}: {taskType}\n> {reason[:200]}"`
- General task completed → `"Task completed: {issue_url}"`

## Automatic Memory Capture

Every task outcome writes to the Lore memory system:

- PR created: `writeEpisodeWithCuration(...)` — Haiku extracts a lesson,
  stored as `auto-curation/{repo}/{taskId}`
- No changes: `writeEpisode(...)` — raw episode for fact extraction
- Failure: `writeEpisodeWithCuration(...)` — lesson extraction from failure

## What Was Built

| Component | Status |
|-----------|--------|
| `terraform/modules/gke-mcp/loretask-crd/` | CRD YAML, controller Deployment, RBAC |
| `agent/src/loretask-controller.ts` | Controller: watches CRs, creates Jobs, stores logs to GCS |
| `agent/src/loretask-controller-main.ts` | Standalone entry point for controller process |
| `agent/src/worker.ts` | `handleClaudeCodeTask` creates LoreTask CR |
| `agent/src/jobs/loretask-watcher.ts` | Watcher: polls, creates PRs, auto-review, Slack, episodes |
| `docker/claude-runner/Dockerfile` | node:24-slim + gh + claude CLI + validation.js |
| `docker/claude-runner/entrypoint.sh` | Dual-mode: implementation + review |
| `.github/workflows/build-claude-runner.yml` | CI for claude-runner image |
| `agent/src/lib/log-storage.ts` | GCS log upload helper |

## Out of Scope (Unchanged)

1. **Multi-cluster** — Single cluster only (your-gke-cluster)
2. **Priority queues** — All tasks equal priority
3. **Resource quotas per team** — No per-team limits on concurrent Jobs
4. **Streaming logs to UI** — Phase 2 (WebSocket)
5. **CRD versioning** — v1alpha1 only, no conversion webhooks

## Acceptance Criteria

1. `implementation` tasks create a LoreTask CR instead of spawning claude
2. Controller creates a Job pod within 15s of CR creation
3. Job pod: clones repo, hydrates context, runs Claude Code, validates,
   commits, pushes
4. Controller updates LoreTask status on Job completion; logs stored in GCS
5. Watcher creates PR from pushed branch when LoreTask succeeds
6. Agent pod restarts do NOT affect running Job pods
7. Failed Jobs surface error in `pipeline.tasks.failure_reason`
8. Token Secrets are deleted after Job completion
9. Multiple tasks can run in parallel
10. Review tasks parse APPROVED/CHANGES_REQUESTED from Claude output
11. Auto-review loop iterates up to 2 times before escalating to human
12. Slack notifications fire for PR creation and failures
13. GitHub Issues are created, updated, and closed per task lifecycle
14. Every task outcome captured as a memory episode