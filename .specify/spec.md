| Branch         | feat/loretask-crd                        |
| Status         | Shipped                                  |
| Created        | 2026-04-01                               |
| Last Updated   | 2026-04-06 (post-ship reconciliation)    |
| Owner          | Platform Engineering                     |
| ADRs           | ADR-011, ADR-012, ADR-013, ADR-014      |

> **Note:** This spec was reconciled against the shipped implementation on 2026-04-06.
> The original spec had significant drift in auth model, CRD schema, and entrypoint
> behavior. The sections below reflect what is actually deployed.

## Problem Statement

Implementation tasks ran `claude --print` inside the long-lived agent pod. This was
fundamentally broken:

1. **CI deploys killed running tasks** — Every push to main triggered
   `build-agent.yml` → deploy → `kubectl rollout restart`, terminating Claude Code
   mid-execution. Tasks went `pending` → `running` → orphaned.
2. **No parallelism** — The worker was single-threaded. One Claude Code session
   blocked the entire agent for 5-15 minutes.
3. **No isolation** — A runaway Claude Code session could OOM the agent pod, taking
   down task polling, schedulers, and health checks.
4. **No observability** — Claude Code stdout/stderr was lost on pod restart.

## Solution: LoreTask CRD + Controller

Replace in-process `spawn("claude")` with a Kubernetes-native pattern:

```
Agent Worker                    K8s API                     Job Pod
─────────────                   ───────                     ─────────
detects pending task ──────►  creates LoreTask CR
                              controller watches ──────►  creates Job + token Secret
                                                           clone repo
                                                          fetch pre-run context
                                                           claude --print ...
                                                          deterministic validation
                                                           git add/commit/push
                               Job completes ◄──────────   exit 0
 controller reads Job logs ◄─  updates LoreTask status
agent watcher reads status ─► creates PR, updates DB
                              deletes Job + token Secret
```

### CRD: `LoreTask`

```yaml
apiVersion: lore.re-cinq.com/v1alpha1
kind: LoreTask
metadata:
  name: loretask-{taskIdShort}
  namespace: lore-agent
  labels:
    lore.re-cinq.com/task-id: {taskId}
    lore.re-cinq.com/task-type: implementation
spec:
  taskId: {uuid}                    # pipeline.tasks.id
  taskType: implementation          # implementation | review | general
  description: "..."                # task description (informational)
  prompt: "..."                     # full rendered prompt passed to claude
  targetRepo: "re-cinq/lore"       # owner/repo
  branch: "lore/impl/..."          # branch to create (implementation) or ignored (review)
  prNumber: 0                       # PR to review (review tasks only)
  model: "claude-sonnet-4-6"       # Claude Code model
  timeoutMinutes: 30               # maps to activeDeadlineSeconds
  image: "ghcr.io/re-cinq/lore-claude-runner:latest"
status:
  phase: Pending | Running | Succeeded | Failed
  jobName: ""
  startedAt: null
  completedAt: null
  exitCode: null
  output: ""                        # last 5000 chars of Claude Code stdout
  changedFiles: 0
  prUrl: ""                         # set by loretask-watcher after PR creation
  prNumber: 0                       # PR number (set by watcher)
  reviewResult: ""                  # "approved" | "changes-requested" | "" (review tasks)
  parentTaskId: ""                  # originating implementation task (review tasks)
  failureReason: ""
  logUrl: ""                        # GCS URL for full structured logs
```

### Auth Model (differs from original spec)

The original spec passed `GITHUB_TOKEN` as a plain env var. The shipped implementation
creates a **per-task K8s Secret** with a fresh GitHub App installation token:

1. Controller calls `GitHubPlatform.getInstallationToken()` before creating the Job.
2. Token stored in `loretask-github-token-{taskIdShort}` (namespace: `lore-agent`).
3. Job pod mounts the secret as `GITHUB_TOKEN` env var via `secretKeyRef`.
4. Controller deletes the secret after reading Job status (best effort).

This avoids long-lived token exposure in Job manifests and aligns with ADR-002
(zero stored credentials).

### Controller (`agent/src/loretask-controller.ts`)

Polls every 15 seconds for `LoreTask` CRs with `phase: Pending`:

1. Creates a GitHub App installation token Secret.
2. Creates a `batch/v1 Job` with the claude-runner image.
   - Resources: 1 CPU, 2Gi memory.
   - `activeDeadlineSeconds`: `timeoutMinutes * 60`.
   - `ttlSecondsAfterFinished: 300`.
   - `backoffLimit: 1` (one retry at the Job level; validation retry is handled
     inside the entrypoint — see below).
3. Updates LoreTask `phase: Running`.
4. On Job completion, reads pod logs, extracts `CHANGES=N` or `REVIEW_RESULT:...`,
   sets `phase: Succeeded | Failed`.
5. Writes structured logs to GCS via `writeLogs()` and sets `logUrl`.
6. Deletes the GitHub token Secret.

### Claude Runner (`docker/claude-runner/entrypoint.sh`)

Two execution modes selected by `TASK_TYPE` env var:

#### Implementation mode (`TASK_TYPE=implementation`)

1. Validate required env vars (`GITHUB_TOKEN`, `TARGET_REPO`, `BRANCH_NAME`, `TASK_PROMPT`).
2. Clone repo with `--depth=1`, create branch.
3. **Pre-run context hydration** (ADR-013): If `LORE_API_URL` and `LORE_INGEST_TOKEN`
   are set, fetch assembled context from `/api/context` before starting Claude Code.
   Agent starts with conventions, ADRs, and memories on turn 1.
4. Inject Lore workflow preamble into the prompt (assemble_context + search_memory
   + write_episode instructions).
5. Run `claude --print --dangerously-skip-permissions --model ${MODEL}`.
6. If no git changes: exit with `NO_CHANGES` (exit 0 for `general` tasks, exit 1
   for `implementation`).
7. **Deterministic validation** (ADR-013): Run `node /validation.js --quick --repo
   /workspace/repo --files <changed-files>`. On failure:
   - Attempt one fix pass: `claude --print` with the error output as prompt.
   - Re-validate. If still failing, print `NEEDS_HUMAN_HELP` and continue to push
     (task marked `needs-human-help` by watcher).
8. `git add -A && git commit && git push origin ${BRANCH_NAME}`.
9. Print `CHANGES=N` for the controller to parse.

#### Review mode (`TASK_TYPE=review`)

1. Validate required env vars (`GITHUB_TOKEN`, `TARGET_REPO`, `PR_NUMBER`, `TASK_PROMPT`).
2. Clone repo, use `gh pr checkout ${PR_NUMBER}` to get the PR branch.
3. Inject review preamble: call `assemble_context` with `template=review`.
4. Run `claude --print --dangerously-skip-permissions --model ${MODEL}`.
5. Parse output for `REVIEW_RESULT:APPROVED` or `REVIEW_RESULT:CHANGES_REQUESTED`.
6. Print structured result; controller stores in `LoreTask.status.reviewResult` as lowercase.

### Watcher (`agent/src/jobs/loretask-watcher.ts`)

Scheduled every 15 seconds. For each completed LoreTask:

- **Succeeded (implementation)**: Create PR via `platform().createPR()`, update
  `pipeline.tasks`, post PR link to GitHub Issue, close Issue.
- **Succeeded (review)**: Parse `reviewResult`. If `"approved"`, mark task reviewed.
  If `"changes-requested"`, create a new implementation LoreTask on the same branch
  (see ADR-012 autonomous review loop).
- **Failed**: Update `pipeline.tasks.failure_reason`, post failure comment to Issue,
  add `lore-failed` label.
- **Cleanup**: Delete LoreTask CRs older than 1 hour.

### Auto-curation

After every terminal outcome (PR created, no-changes, failure), the watcher calls
`writeEpisodeWithCuration()` to ingest a lesson-learned episode (see ADR-014).

## What Changed vs Original Spec

| Area | Original Spec | Shipped |
|------|--------------|---------|
| GitHub auth | `GITHUB_TOKEN` env var | Per-task K8s Secret with App installation token |
| CRD spec fields | taskId, taskType, description, prompt, targetRepo, branch, model, timeoutMinutes, image | + `prNumber` (for review tasks) |
| CRD status fields | phase, jobName, startedAt, completedAt, exitCode, output, changedFiles, prUrl, failureReason | + `reviewResult`, `parentTaskId`, `logUrl` |
| reviewResult values | APPROVED \| CHANGES_REQUESTED (uppercase) | "approved" \| "changes-requested" (lowercase) |
| Runner modes | Implementation only | Implementation + Review (ADR-012) |
| Pre-run context | Not in spec | Fetches from `/api/context` before running Claude Code (ADR-013) |
| Deterministic validation | Not in spec | lint/typecheck + one-shot fix retry (ADR-013) |
| Post-task curation | Not in spec | Episode + Haiku lesson extraction (ADR-014) |
| Controller location | `agent/src/loretask-controller.ts` | Same, but runs as separate process via `loretask-controller-main.ts` |

**Note on `logUrl`:** While `logUrl` is set by the controller and stored in the CRD at runtime,
it is not formally defined in `crd.yaml` OpenAPI schema. The field is stored as part of the
status but is not validated by the schema. Consider adding it to the CRD schema for consistency.

## File Index

| File | Purpose |
|------|---------|
| `terraform/modules/gke-mcp/loretask-crd/` | CRD YAML, controller Deployment, RBAC |
| `agent/src/loretask-controller.ts` | Controller: watches CRs, creates Jobs, updates status |
| `agent/src/loretask-controller-main.ts` | Controller entrypoint (separate process) |
| `agent/src/jobs/loretask-watcher.ts` | Watcher: creates PRs, handles review loop |
| `docker/claude-runner/Dockerfile` | Runner image (node:22-slim + git + claude CLI) |
| `docker/claude-runner/entrypoint.sh` | Runner entrypoint (implementation + review modes) |
| `.github/workflows/build-claude-runner.yml` | CI for claude-runner image |

## Out of Scope

1. **Multi-cluster** — Single cluster only (`n8n-cluster`)
2. **Priority queues** — All tasks equal priority
3. **Resource quotas per team** — No per-team limits on concurrent Jobs
4. **CRD versioning** — `v1alpha1` only, no conversion webhooks

## Acceptance Criteria

1. `implementation` tasks create a LoreTask CR instead of spawning claude in-process.
2. Controller creates a Job pod within 15s of CR creation.
3. Job pod fetches pre-run context, runs Claude Code, commits and pushes changes.
4. Deterministic validation runs before commit; one fix retry attempted on failure.
5. Controller updates LoreTask status on Job completion; logs uploaded to GCS.
6. Agent creates PR from pushed branch when LoreTask succeeds.
7. Agent pod restarts do NOT affect running Job pods.
8. Failed Jobs surface error in `pipeline.tasks.failure_reason`.
9. Job pods are cleaned up within 5 min of completion (ttlSecondsAfterFinished).
10. Multiple implementation tasks can run in parallel.
11. `review` tasks check out PR branch, run Claude Code, return structured result.
12. Per-task GitHub token Secrets are deleted after Job completion.