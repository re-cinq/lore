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
                                                          claude --print ...
                                                          git add/commit/push
                              Job completes ◄──────────   exit 0
controller reads Job logs ◄─  updates LoreTask status
loretask-watcher polls ────►  creates PR / posts to Slack
                              deletes CR after 1 hour
```

### CRD: `LoreTask`

```yaml
apiVersion: lore.re-cinq.com/v1alpha1
kind: LoreTask
metadata:
  name: loretask-{task-id-short}
  namespace: lore-agent
  labels:
    lore.re-cinq.com/task-id: {full-uuid}
    lore.re-cinq.com/task-type: implementation | review | general
spec:
  taskId: {uuid}                    # pipeline.tasks.id
  taskType: implementation          # implementation | review | general
  description: "..."                # human-readable task description
  prompt: "..."                     # full rendered prompt
  targetRepo: "re-cinq/lore"       # owner/repo
  branch: "lore/impl/..."          # branch to create (implementation) or read (review)
  prNumber: 0                       # PR number, required for review tasks
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
  changedFiles: 0                   # number of changed files (0 for general/review)
  reviewResult: ""                  # APPROVED | CHANGES_REQUESTED (review tasks only)
  parentTaskId: ""                  # parent implementation task (review tasks only)
  prUrl: ""                         # created PR URL (implementation tasks)
  prNumber: 0                       # created PR number
  logUrl: ""                        # GCS log URL gs://lore-task-logs/{repo}/{taskId}/output.log
  failureReason: ""
```

### Controller (`agent/src/loretask-controller.ts`)

A TypeScript controller that:

1. **Watches** LoreTask CRs with `phase: Pending` (15s poll)
2. **Creates a per-task K8s Secret** with a fresh GitHub App
   installation token (`loretask-github-token-{taskIdShort}`).
   Tokens are short-lived — created just before Job launch, deleted
   after LoreTask cleanup.
3. **Creates a Job** with the claude-runner image:
   - Mounts: `ANTHROPIC_API_KEY` from `lore-agent-anthropic-key`,
     `GITHUB_TOKEN` from per-task secret, `LORE_INGEST_TOKEN` (optional)
   - Env: `TASK_PROMPT`, `TARGET_REPO`, `BRANCH_NAME`, `MODEL`,
     `TASK_TYPE`, `PR_NUMBER`, `LORE_API_URL`
   - Resources: 1 CPU, 2Gi memory, `activeDeadlineSeconds` from
     `timeoutMinutes`
   - `backoffLimit: 1`, `ttlSecondsAfterFinished: 300`
4. **Monitors** the Job: updates LoreTask `phase` on completion
5. **On success**: reads Job pod logs (last 5000 chars), extracts
   changed file count, sets `phase: Succeeded`
6. **On failure**: captures stderr, sets `phase: Failed` with reason
7. Logs are stored to GCS at
   `gs://lore-task-logs/{targetRepo}/{taskId}/output.log`

### Claude Runner Image (`docker/claude-runner/`)

`node:22-slim` + `git` + `gh` + `claude` CLI. Non-root user,
WORKDIR `/workspace`.

Entrypoint (`entrypoint.sh`) supports two modes:

#### Implementation mode (`TASK_TYPE != review`)

1. Validate required env vars: `GITHUB_TOKEN`, `TARGET_REPO`,
   `BRANCH_NAME`, `TASK_PROMPT`
2. Configure git (user: "Lore Agent", email: lore@re-cinq.com)
3. Clone repo (`--depth=1`) and create branch
4. **Pre-run context hydration**: If `LORE_API_URL` and
   `LORE_INGEST_TOKEN` are set, fetch assembled context from
   `/api/context?repo=...&template=implementation&query=...` before
   running Claude Code. This gives the agent conventions, ADRs,
   memories, and graph on turn 1 (Minions-inspired).
5. Build full prompt: pre-loaded context (if available) + Lore
   workflow preamble + task prompt
6. Run `claude --print --dangerously-skip-permissions --verbose
   --model "${MODEL}" -- "${FULL_PROMPT}"`
7. Check for changes. If none:
   - `general` tasks: exit 0 (informational output only)
   - all other types: print `NO_CHANGES`, exit 1
8. **Deterministic validation** (if `/validation.js` present):
   Run lint/typecheck on changed files. On failure:
   - Attempt 1 fix retry: feed errors back to Claude Code
   - Re-validate; if still failing, print `NEEDS_HUMAN_HELP`
9. Commit and push (`git add -A`, then commit with message
   `lore: {taskType} — {branchSlug}`)
10. Print `CHANGES={count}`

#### Review mode (`TASK_TYPE = review`)

1. Validate required env vars: `GITHUB_TOKEN`, `TARGET_REPO`,
   `PR_NUMBER`, `TASK_PROMPT`
2. Clone repo and check out PR branch via `gh pr checkout`
3. Prepend review preamble (call `assemble_context` with template
   `review`, call `search_memory` for known patterns)
4. Run Claude Code
5. Parse output for structured result markers:
   - `REVIEW_RESULT:APPROVED` or `REVIEW_APPROVED` → result = APPROVED
   - `REVIEW_RESULT:CHANGES_REQUESTED:...` or
     `REVIEW_CHANGES_REQUESTED` → result = CHANGES_REQUESTED:{feedback}
   - No marker → treated as CHANGES_REQUESTED (last 500 chars as
     feedback)
6. Write result to `/tmp/review-result.txt` and exit 0

### LoreTask Watcher (`agent/src/jobs/loretask-watcher.ts`)

Scheduled job polling every 15s. Handles four outcome paths:

#### 1. Succeeded — implementation with code changes

Creates a GitHub PR from the pushed branch, updates `pipeline.tasks`
with `status=pr-created`, links and closes the GitHub Issue, posts PR
URL to Slack (task's originating channel, or repo's mapped channel),
writes an episode with curation for lesson extraction. If `auto_review`
is enabled for the repo, immediately creates a review LoreTask CR.

#### 2. Succeeded — no code changes (changedFiles = 0)

For `general` tasks or tasks that produced no changes: creates or
updates a GitHub Issue with the Claude Code output as the body, sets
`status=completed` in `pipeline.tasks`, posts to Slack. Does NOT create
a PR. Issue stays open (it is the deliverable for general tasks).

#### 3. Succeeded — review task (taskType = review)

Reads `reviewResult` from LoreTask status:

- **APPROVED**: marks parent implementation task `completed`, posts
  "approved" comment on GitHub Issue
- **CHANGES_REQUESTED (iteration < 2)**: creates a new implementation
  LoreTask CR on the same branch with review feedback as prompt,
  increments `review_iteration` counter, posts comment on Issue
- **CHANGES_REQUESTED (iteration >= 2)**: escalates to human — adds
  `needs-human-review` label to Issue, marks status `review`

#### 4. Failed

Updates `pipeline.tasks` with `status=failed`, sets `log_url` to GCS
path, comments failure reason on GitHub Issue (adds `lore-failed`
label), posts to Slack. Writes episode with curation (lesson
extraction).

#### Cleanup

Deletes LoreTask CRs that are in a terminal phase and are more than 1
hour past `completedAt`. Also deletes the per-task GitHub token secret.

### Agent Worker Changes

`handleClaudeCodeTask` in `agent/src/worker.ts` creates a LoreTask CR
via `@kubernetes/client-node` instead of spawning claude. Sets task
status to `running` with the CR name as the agent reference.

### GitHub Issues Integration

Every pipeline task creates a GitHub Issue on the target repo with the
`lore-managed` label (and task type label). The watcher:
- Links PRs to issues (comment + close on PR creation)
- Posts failure reasons as issue comments
- Escalates to human review via labels

Optional approval gate (configured per repo via `settings.approval_required`):
tasks wait for a human to add an `approved` label before the worker
picks them up.

## What Changed vs. Original Design

| Component | Original Spec | Actual Implementation |
|-----------|--------------|----------------------|
| GitHub token | Mount existing Secret | Per-task short-lived Secret from GitHub App |
| Entrypoint | Single implementation path | Dual mode: implementation + review |
| Context | Not specified | Pre-run hydration from Lore API |
| Validation | Not specified | Deterministic lint/typecheck, 1-retry cap |
| No-changes handling | exit 1 always | `general` type exits 0; others exit 1 |
| Post-success | Create PR | Create PR or Issue (depending on changedFiles) |
| Auto-review | Not specified | Watcher auto-creates review CR if `auto_review` enabled |
| Review loop | Not specified | Up to 2 iterations, then escalate to human |
| Slack | Not specified | PR links, completions, failures posted to channel |
| CR cleanup | ttlSecondsAfterFinished | Watcher deletes CRs after 1 hour + cleans token secret |
| Log storage | Not specified | GCS at `gs://lore-task-logs/{repo}/{taskId}/output.log` |
| Episode capture | Not specified | `writeEpisodeWithCuration` on PR creation and failure |

## File Map

| File | Role |
|------|------|
| `agent/src/loretask-controller.ts` | Watches Pending CRs, creates Jobs + token Secrets |
| `agent/src/loretask-controller-main.ts` | Controller entry point |
| `agent/src/jobs/loretask-watcher.ts` | Polls completed CRs, creates PRs, handles review loop |
| `agent/src/worker.ts` | Creates LoreTask CRs instead of spawning claude |
| `docker/claude-runner/Dockerfile` | Runner image (node:22-slim + git + gh + claude) |
| `docker/claude-runner/entrypoint.sh` | Dual-mode runner script |
| `terraform/modules/gke-mcp/loretask-crd/` | CRD YAML, RBAC, controller Deployment |
| `.github/workflows/build-claude-runner.yml` | CI: build + push claude-runner image |

## Out of Scope

1. **Multi-cluster** — Single cluster only (n8n-cluster)
2. **Priority queues** — All tasks equal priority
3. **Resource quotas per team** — No per-team Job limits
4. **Streaming logs to UI** — Logs stored to GCS; UI reads from GCS URL
5. **CRD versioning** — v1alpha1 only

## Acceptance Criteria

1. `implementation` tasks create a LoreTask CR; controller creates Job
   within 10s
2. Job pod clones repo, runs Claude Code, commits and pushes changes
3. Controller updates LoreTask status on Job completion
4. Watcher creates PR and closes GitHub Issue on success
5. Review tasks parse `REVIEW_RESULT` marker and update parent task
6. Auto-review loop iterates up to 2 times, then escalates to human
7. Agent pod restarts do NOT affect running Job pods
8. Failed Jobs surface error in `pipeline.tasks.failure_reason` and
   GitHub Issue comment
9. Per-task GitHub token secrets are created before Job launch and
   deleted after cleanup
10. GCS log URL is set on both success and failure
11. Slack notification sent on PR creation and task failure
