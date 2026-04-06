# Feature Specification: LoreTask CRD — Ephemeral Claude Code Execution

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | LoreTask CRD + Controller                |
| Branch         | feat/loretask-crd                        |
| Status         | Shipped (updated 2026-04-06)             |
| Created        | 2026-04-01                               |
| Owner          | Platform Engineering                     |
| Target         | 1 week                                   |

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
                                                          validate changes
                                                          git add/commit/push
                              Job completes ◄──────────   exit 0
controller reads Job logs ◄─  updates LoreTask status
agent reads LoreTask ──────►  creates PR, updates DB
                              writes episode, Slack notify
                              (optionally) creates review task
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
    lore.re-cinq.com/task-type: implementation
spec:
  taskId: {uuid}                    # pipeline.tasks.id
  taskType: implementation          # from task-types.yaml
  description: "..."                # task description
  prompt: "..."                     # full rendered prompt
  targetRepo: "re-cinq/lore"       # owner/repo
  branch: "lore/impl/..."          # branch to create/push
  model: "claude-sonnet-4-6"       # Claude Code model
  timeoutMinutes: 30               # max Job duration
  image: "ghcr.io/re-cinq/lore-claude-runner:latest"
  prNumber: 42                     # review tasks only — PR to check out
status:
  phase: Pending | Running | Succeeded | Failed
  jobName: ""                       # created Job name
  startedAt: null
  completedAt: null
  exitCode: null
  output: ""                        # agent stdout summary (last 5000 chars)
  changedFiles: 0
  prUrl: ""                         # set by watcher after PR is created
  prNumber: 0                       # PR number on target repo
  reviewResult: ""                  # "approved" | "changes-requested" | ""
  parentTaskId: ""                  # review tasks only — links to impl task
  failureReason: ""
  logUrl: ""                        # GCS path: gs://{bucket}/{repo}/{taskId}/output.log
```

### Controller (`agent/src/loretask-controller.ts`)

Polls (15 s interval) LoreTask CRs. For each `Pending` CR:

1. **Creates a per-task GitHub token Secret** — requests a short-lived
   GitHub App installation token, stores it as
   `loretask-github-token-{taskId-short}` in the `lore-agent` namespace.
2. **Creates a Job** with the claude-runner image:
   - Mounts the token secret as `GITHUB_TOKEN`
   - Mounts `ANTHROPIC_API_KEY` from the agent secrets
   - Env: `TASK_PROMPT`, `TARGET_REPO`, `BRANCH_NAME`, `MODEL`,
     `TASK_TYPE`, `LORE_API_URL`, `LORE_INGEST_TOKEN`
   - Resources: 1 CPU, 2Gi memory, `activeDeadlineSeconds` from
     `timeoutMinutes`
3. **Monitors** the Job: patches LoreTask `phase` to `Running` on start,
   `Succeeded`/`Failed` on completion.
4. **On completion**: reads Job pod logs via GCS (`writeLogs`), extracts
   `changedFiles` count from the `CHANGES=N` output line, copies the
   last 5000 chars of output to `status.output`.
5. **Cleanup**: Job pods have `ttlSecondsAfterFinished: 300`. The
   per-task GitHub token Secret is deleted by the watcher after cleanup.

### Claude Runner Image (`docker/claude-runner/`)

`node:22-slim` + `git` + `claude` CLI + `gh` CLI.

Entrypoint (`entrypoint.sh`) supports two modes via `TASK_TYPE`:

#### Implementation mode (default)

```bash
MODEL="${MODEL:-claude-sonnet-4-6}"

# 1. Clone repo, create branch
git clone --depth=1 "https://x-access-token:${GITHUB_TOKEN}@..." /workspace/repo
git checkout -b "${BRANCH_NAME}"

# 2. Pre-run context hydration (ADR-013)
# Fetch assembled context from LORE_API_URL before running Claude Code.
# Injects conventions, ADRs, memories, and graph on turn 1.
PRE_CONTEXT=$(curl -sf "${LORE_API_URL}/api/context?repo=...&template=implementation&query=...")

# 3. Build prompt with Lore workflow preamble
# If context available: inject as "Pre-loaded Context" block.
# If not: inject IMPORTANT workflow reminder.
FULL_PROMPT="${LORE_PREAMBLE}\n\n${TASK_PROMPT}"

# 4. Run Claude Code
claude --print --dangerously-skip-permissions --verbose --model "${MODEL}" -- "${FULL_PROMPT}"

# 5. Check for changes
# TASK_TYPE=general: exit 0 on no changes (research/analysis tasks)
# all other types: exit 1 on no changes

# 6. Deterministic validation (ADR-013, Minions-inspired)
# Detect repo tooling (node/go/python/rust) and run lint/typecheck.
# On failure: one Claude Code retry with fix prompt.
# If still failing: emit NEEDS_HUMAN_HELP and push anyway for human review.

# 7. Commit and push
git add -A
git commit -m "lore: ${TASK_TYPE} — ${BRANCH_SLUG}"
git push origin "${BRANCH_NAME}"
echo "CHANGES=${count}"
```

#### Review mode (`TASK_TYPE=review`)

```bash
# 1. Clone and check out the PR branch via `gh pr checkout ${PR_NUMBER}`
# 2. Run Claude Code with a review preamble:
#    - Call assemble_context with template 'review'
#    - Call search_memory for known patterns
# 3. Parse structured output:
#    REVIEW_RESULT:APPROVED → result="approved"
#    REVIEW_RESULT:CHANGES_REQUESTED:<feedback> → result="changes-requested"
#    (fallback: treat last 500 chars as changes-requested)
# 4. Write /tmp/review-result.txt for the controller to read
# No git commit or push in review mode.
```

### Agent Watcher (`agent/src/jobs/loretask-watcher.ts`)

Scheduled job (runs every minute) that polls LoreTask CRs and handles
completion, linking results back to the pipeline:

#### On `Succeeded` (implementation, `changedFiles > 0`)

1. Creates a GitHub PR from the pushed branch.
2. Updates `pipeline.tasks` (`status=pr-created`, `pr_url`, `log_url`).
3. Links PR to GitHub Issue (comments + closes issue).
4. Patches LoreTask CR with `prUrl` + `prNumber`.
5. Posts PR link to Slack (originating channel or repo's mapped channel).
6. Calls `writeEpisodeWithCuration()` for auto memory capture.
7. If `auto_review` enabled for the repo: creates a `review` LoreTask CR
   targeting the new PR.

#### On `Succeeded` (implementation, `changedFiles == 0`)

General/research tasks produce no file changes. The watcher:
1. Creates (or updates) a GitHub Issue with the agent's output as the body.
2. Updates `pipeline.tasks` (`status=completed`).
3. Does **not** close the issue (it is the deliverable).
4. Posts issue link to Slack.
5. Calls `writeEpisode()` for passive memory capture.

#### On `Succeeded` (review task)

1. Reads `status.reviewResult` from the LoreTask CR.
2. **APPROVED**: marks parent task `completed`, comments on issue.
3. **CHANGES_REQUESTED** (iteration < 2): creates a new `implementation`
   LoreTask CR on the same branch with feedback as context; increments
   `review_iteration` on the parent task.
4. **CHANGES_REQUESTED** (iteration >= 2): escalates to human — adds
   `needs-human-review` label on the issue, marks parent task `review`.

#### On `Failed`

1. Updates `pipeline.tasks` (`status=failed`, `failure_reason`).
2. Sets `log_url` to GCS path.
3. Comments failure on GitHub Issue, adds `lore-failed` label.
4. Posts failure message to Slack.
5. Calls `writeEpisodeWithCuration()` to capture lesson learned.

#### Cleanup

LoreTasks with `prUrl` (or `failed`) older than 1 hour are deleted.
The per-task GitHub token Secret (`loretask-github-token-{short}`) is
also deleted at that time.

## What Was Built

| Component | Description |
|-----------|-------------|
| `terraform/modules/gke-mcp/loretask-crd/` | CRD YAML, controller Deployment, RBAC |
| `agent/src/loretask-controller.ts` | Controller: watches CRs, creates Jobs, reads logs |
| `agent/src/loretask-controller-main.ts` | Entry point for controller process |
| `agent/src/worker.ts` | Modified: `handleClaudeCodeTask` creates LoreTask CR |
| `agent/src/jobs/loretask-watcher.ts` | Watcher: handles PR creation, review loop, Slack, episodes |
| `docker/claude-runner/Dockerfile` | Runner image (node:22-slim + git + claude + gh) |
| `docker/claude-runner/entrypoint.sh` | Runner script: impl + review modes, context hydration, validation |
| `.github/workflows/build-claude-runner.yml` | CI for claude-runner image |

## Evolved Beyond Original Spec

The following were added after initial implementation:

| Feature | ADR |
|---------|-----|
| Pre-run context hydration (fetch context before Claude starts) | ADR-013 |
| Deterministic validation with one-retry fix pass | ADR-013 |
| `TASK_TYPE=general` exits 0 on no changes | ADR-013 |
| Review mode in entrypoint (`TASK_TYPE=review`) | ADR-012 |
| Auto-review loop (watcher creates review LoreTask after PR) | ADR-012 |
| `review_iteration` cap at 2, escalation to human | ADR-012 |
| Slack notifications (PR links, failures) | ADR-013 |
| GCS log storage (`log_url`) | ADR-013 |
| Auto-episode capture via `writeEpisodeWithCuration` | ADR-014 |
| `reviewResult` + `parentTaskId` CRD status fields | ADR-012 |
| Per-task ephemeral GitHub token Secret | (impl detail) |

## Out of Scope

1. **Multi-cluster** — Single cluster only (n8n-cluster)
2. **Priority queues** — All tasks equal priority
3. **Resource quotas per team** — No per-team limits on concurrent Jobs
4. **Real-time streaming logs to UI** — GCS-backed; UI polls via log_url
5. **CRD versioning** — v1alpha1 only, no conversion webhooks

## Acceptance Criteria

1. `implementation` tasks create a LoreTask CR instead of spawning claude
2. Controller creates a Job pod within 10s of CR creation
3. Job pod clones repo, runs Claude Code with pre-loaded context, commits and pushes
4. Deterministic validation runs after Claude edits; one retry on failure
5. Controller updates LoreTask status on Job completion; logs stored in GCS
6. Watcher creates PR from pushed branch when LoreTask succeeds
7. Agent pod restarts do NOT affect running Job pods
8. Failed Jobs surface error in `pipeline.tasks.failure_reason` and GitHub Issue
9. Job pods are cleaned up within 5 min of completion (ttlSecondsAfterFinished)
10. Multiple implementation tasks can run in parallel
11. Review tasks check out PRs, output structured REVIEW_RESULT, no code push
12. Auto-review loop triggers at most 2 agent iterations before escalating to human
13. Slack channel receives PR links and failure messages
14. Every task completion writes an episode for passive memory capture
