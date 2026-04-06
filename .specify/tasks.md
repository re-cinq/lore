# Task Breakdown: LoreTask CRD — Ephemeral Claude Code Execution

> **Status: Shipped** — All tasks completed. Spec status updated 2026-04-06 to reflect actual
> implementation state (tasks were marked incomplete despite the feature being fully deployed).

## Phase 1: CRD + Runner Image

- [x] T001 [P] Define LoreTask CRD YAML in `terraform/modules/gke-mcp/loretask-crd/crd.yaml` — apiVersion lore.re-cinq.com/v1alpha1, spec fields (taskId, prompt, targetRepo, branch, model, timeoutMinutes), status fields (phase, jobName, output, changedFiles, prUrl, failureReason)
- [x] T002 [P] Create claude-runner Dockerfile in `docker/claude-runner/Dockerfile` — node:22-slim + git + claude CLI, non-root user, WORKDIR /workspace
- [x] T003 [P] Create claude-runner entrypoint `docker/claude-runner/entrypoint.sh` — clone repo with GITHUB_TOKEN, checkout branch, run claude --print --dangerously-skip-permissions, git add/commit/push, output CHANGES summary
- [x] T004 Create CI workflow `.github/workflows/build-claude-runner.yml` — build and push ghcr.io/re-cinq/lore-claude-runner on changes to docker/claude-runner/ [DEPENDS ON: T002, T003]

## Phase 2: Controller

- [x] T005 Create RBAC manifests in `terraform/modules/gke-mcp/loretask-crd/rbac.yaml` — ServiceAccount, ClusterRole (watch/create/update loretasks, create/list/delete jobs, get/list pods, read pods/log), ClusterRoleBinding [DEPENDS ON: T001]
- [x] T006 Create controller in `agent/src/loretask-controller.ts` — watch LoreTask CRs with phase=Pending via K8s API, create Job with claude-runner image, mount secrets (ANTHROPIC_API_KEY, GitHub App creds), set resource limits (1 CPU, 2Gi), set activeDeadlineSeconds from timeoutMinutes [DEPENDS ON: T001, T005]
- [x] T007 Add Job completion monitor to controller — watch Job status, on success read pod logs + extract changed files count + set LoreTask phase=Succeeded, on failure capture logs + set phase=Failed with reason [DEPENDS ON: T006]
- [x] T008 Add cleanup logic — delete Job pods 5 min after LoreTask status is read (ttlSecondsAfterFinished or manual cleanup) [DEPENDS ON: T007]

## Phase 3: Agent Integration

- [x] T009 Replace `handleClaudeCodeTask` in `agent/src/worker.ts` — create LoreTask CR via @kubernetes/client-node instead of spawning claude, set task status to running with job reference [DEPENDS ON: T006]
- [x] T010 Create LoreTask watcher job in `agent/src/jobs/loretask-watcher.ts` — poll completed LoreTasks every 15s, on Succeeded create PR via platform().createPR and update pipeline.tasks, on Failed update pipeline.tasks with failure_reason [DEPENDS ON: T007, T009]
- [x] T011 Register loretask-watcher in agent scheduler `agent/src/scheduler.ts` — add to job list, run every 15s [DEPENDS ON: T010]
- [x] T012 Remove claude CLI and git from `agent/Dockerfile` — no longer needed in agent pod, remove the RUN lines added earlier [DEPENDS ON: T009]

## Phase 4: Deploy + Verify

- [x] T013 Apply CRD to cluster — kubectl apply crd.yaml + rbac.yaml, verify with kubectl get crd loretasks.lore.re-cinq.com [DEPENDS ON: T001, T005]
- [x] T014 Build and push claude-runner image — trigger build-claude-runner.yml, verify image in GHCR [DEPENDS ON: T004]
- [x] T015 Deploy updated agent — helm upgrade with controller + watcher, verify LoreTask CR creation on implementation task [DEPENDS ON: T011, T012, T013, T014]
- [x] T016 End-to-end test — submit implementation task, verify Job pod spawns, Claude Code edits files, branch pushed, PR created, Job cleaned up [DEPENDS ON: T015]
