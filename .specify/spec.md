# Feature Specification: LoreTask CRD — Ephemeral Claude Code Execution

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | LoreTask CRD + Controller                |
| Branch         | feat/loretask-crd                        |
| Status         | Draft                                    |
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
                                                          claude --print ...
                                                          git add/commit/push
                              Job completes ◄──────────   exit 0
controller reads Job logs ◄─  updates LoreTask status
agent reads LoreTask ──────►  creates PR, updates DB
                              deletes Job pod
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
  branch: "lore/impl/..."          # branch to create
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
  prUrl: ""
  prNumber: 0
  failureReason: ""
```

### Controller

A Go or TypeScript controller (operator) that:

1. **Watches** LoreTask CRs with `phase: Pending`
2. **Creates a Job** with the claude-runner image:
   - Mounts: `ANTHROPIC_API_KEY`, GitHub App credentials
   - Env: `TASK_PROMPT`, `TARGET_REPO`, `BRANCH_NAME`, `MODEL`
   - Entrypoint: `claude-runner.sh` (clone → claude → commit → push)
   - Resources: 1 CPU, 2Gi memory, 30 min activeDeadlineSeconds
3. **Monitors** the Job: updates LoreTask `phase` on completion
4. **On success**: reads Job pod logs, extracts changed files count,
   sets `phase: Succeeded`
5. **On failure**: captures stderr, sets `phase: Failed` with reason
6. **Cleanup**: deletes completed Job pods after status is read
   (ttlSecondsAfterFinished: 300)

### Claude Runner Image

Minimal container: `node:22-slim` + `git` + `claude` CLI.

Entrypoint script (`claude-runner.sh`):
```bash
#!/bin/bash
set -euo pipefail

# Clone repo
git clone --depth=1 "https://x-access-token:${GITHUB_TOKEN}@github.com/${TARGET_REPO}.git" /workspace
cd /workspace
git checkout -b "${BRANCH_NAME}"
git config user.name "Lore Agent"
git config user.email "lore@re-cinq.com"

# Run Claude Code
claude --print \
  --dangerously-skip-permissions \
  --verbose \
  --model "${MODEL}" \
  -- "${TASK_PROMPT}"

# Check for changes
if [ -z "$(git status --porcelain)" ]; then
  echo "NO_CHANGES"
  exit 1
fi

# Commit and push
git add -A
git commit -m "lore: ${TASK_TYPE} — $(echo ${BRANCH_NAME} | sed 's/.*\///')"
git push origin "${BRANCH_NAME}"

echo "CHANGES=$(git diff --stat HEAD~1 | tail -1)"
```

### Agent Worker Changes

Replace `handleClaudeCodeTask()` with:

```typescript
async function handleClaudeCodeTask(task, targetRepo, branchName, model, issueNumber) {
  // Create LoreTask CR instead of spawning claude
  const cr = {
    apiVersion: "lore.re-cinq.com/v1alpha1",
    kind: "LoreTask",
    metadata: {
      name: `loretask-${task.id.substring(0, 8)}`,
      namespace: "lore-agent",
      labels: { "lore.re-cinq.com/task-id": task.id },
    },
    spec: {
      taskId: task.id,
      taskType: task.task_type,
      description: task.description,
      prompt: buildPrompt(task.task_type, task.description),
      targetRepo,
      branch: branchName,
      model: model || "claude-sonnet-4-6",
      timeoutMinutes: 30,
    },
  };

  await k8sApi.createNamespacedCustomObject(
    "lore.re-cinq.com", "v1alpha1", "lore-agent", "loretasks", cr
  );
  // Set task to "queued-for-job" — controller takes over from here
  await setStatus(task.id, "running", { agent_id: `job-${task.id.substring(0, 8)}` });
}
```

### Completion Handler

A new scheduled job in the agent polls for completed LoreTasks:

```typescript
async function checkLoreTasks() {
  const tasks = await k8sApi.listNamespacedCustomObject(
    "lore.re-cinq.com", "v1alpha1", "lore-agent", "loretasks"
  );
  for (const lt of tasks.items) {
    if (lt.status.phase === "Succeeded" && !lt.status.prUrl) {
      // Create PR from the pushed branch
      const pr = await platform().createPR(
        lt.spec.targetRepo, lt.spec.branch, ...
      );
      await setStatus(lt.spec.taskId, "pr-created", { pr_url: pr.url });
      // Patch LoreTask CR with PR URL, schedule cleanup
    }
    if (lt.status.phase === "Failed") {
      await setStatus(lt.spec.taskId, "failed", {
        failure_reason: lt.status.failureReason,
      });
    }
  }
}
```

## What Changes

| Component | Change |
|-----------|--------|
| `terraform/modules/gke-mcp/loretask-crd/` | New: CRD YAML, controller Deployment, RBAC |
| `agent/src/loretask-controller.ts` | New: controller that watches CRs, creates Jobs |
| `agent/src/worker.ts` | Modify: `handleClaudeCodeTask` creates CR instead of spawn |
| `agent/src/jobs/loretask-watcher.ts` | New: scheduled job polls completed LoreTasks, creates PRs |
| `docker/claude-runner/` | New: Dockerfile + entrypoint for Job pods |
| `.github/workflows/build-claude-runner.yml` | New: CI for claude-runner image |
| `agent/Dockerfile` | Remove: claude CLI + git (no longer needed in agent) |

## Out of Scope

1. **Multi-cluster** — Single cluster only (n8n-cluster)
2. **Priority queues** — All tasks equal priority
3. **Resource quotas per team** — No per-team limits on concurrent Jobs
4. **Streaming logs to UI** — Phase 2 (read Job logs via WebSocket)
5. **Auto-retry** — Failed Jobs are not retried automatically
6. **CRD versioning** — v1alpha1 only, no conversion webhooks

## Acceptance Criteria

1. `implementation` tasks create a LoreTask CR instead of spawning claude
2. Controller creates a Job pod within 10s of CR creation
3. Job pod clones repo, runs Claude Code, commits and pushes changes
4. Controller updates LoreTask status on Job completion
5. Agent creates PR from pushed branch when LoreTask succeeds
6. Agent pod restarts do NOT affect running Job pods
7. Failed Jobs surface error in pipeline.tasks.failure_reason
8. Job pods are cleaned up within 5 min of completion
9. Multiple implementation tasks can run in parallel
