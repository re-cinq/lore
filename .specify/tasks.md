# Task Breakdown: LoreTask CRD — Ephemeral Claude Code Execution

> All tasks completed. Feature shipped. See `.specify/spec.md` for post-ship
> reconciliation of what was built vs originally specced.

## Phase 1: CRD + Runner Image

- [x] T001 [P] Define LoreTask CRD YAML in `terraform/modules/gke-mcp/loretask-crd/crd.yaml` — apiVersion lore.re-cinq.com/v1alpha1, spec fields (taskId, prompt, targetRepo, branch, model, timeoutMinutes, **prNumber**), status fields (phase, jobName, output, changedFiles, prUrl, **reviewResult**, **parentTaskId**, **logUrl**, failureReason)
- [x] T002 [P] Create claude-runner Dockerfile in `docker/claude-runner/Dockerfile` — node:22-slim + git + claude CLI, non-root user, WORKDIR /workspace
- [x] T003 [P] Create claude-runner entrypoint `docker/claude-runner/entrypoint.sh` — implementation mode: clone repo, fetch pre-run context, run claude, deterministic validation + fix retry, git add/commit/push; review mode: checkout PR branch, run claude, parse REVIEW_RESULT
- [x] T004 Create CI workflow `.github/workflows/build-claude-runner.yml` — build and push ghcr.io/re-cinq/lore-claude-runner on changes to docker/claude-runner/ [DEPENDS ON: T002, T003]

## Phase 2: Controller

- [x] T005 Create RBAC manifests in `terraform/modules/gke-mcp/loretask-crd/rbac.yaml` — ServiceAccount, ClusterRole (watch/create/update loretasks, create/list/delete jobs, get/list pods, read pods/log, create/delete secrets), ClusterRoleBinding [DEPENDS ON: T001]
- [x] T006 Create controller in `agent/src/loretask-controller.ts` — poll LoreTask CRs with phase=Pending every 15s, create GitHub App installation token Secret per task, create Job with claude-runner image, mount secrets, set resource limits (1 CPU, 2Gi), set activeDeadlineSeconds from timeoutMinutes [DEPENDS ON: T001, T005]
- [x] T007 Add Job completion monitor to controller — watch Job status, on success read pod logs + extract changed files count + upload to GCS + set LoreTask phase=Succeeded, on failure capture logs + set phase=Failed with reason; delete token Secret [DEPENDS ON: T006]
- [x] T008 Add cleanup logic — delete Job pods 5 min after LoreTask status is read (ttlSecondsAfterFinished: 300); delete old LoreTask CRs after 1 hour in watcher [DEPENDS ON: T007]

## Phase 3: Agent Integration

- [x] T009 Replace `handleClaudeCodeTask` in `agent/src/worker.ts` — create LoreTask CR via @kubernetes/client-node instead of spawning claude, set task status to running with job reference [DEPENDS ON: T006]
- [x] T010 Create LoreTask watcher job in `agent/src/jobs/loretask-watcher.ts` — poll completed LoreTasks every 15s, on Succeeded create PR via platform().createPR and update pipeline.tasks (implementation) or trigger review loop (review), on Failed update pipeline.tasks with failure_reason; post-task auto-curation via writeEpisodeWithCuration [DEPENDS ON: T007, T009]
- [x] T011 Register loretask-watcher in agent scheduler `agent/src/scheduler.ts` — add to job list, run every 15s [DEPENDS ON: T010]
- [x] T012 Remove claude CLI and git from `agent/Dockerfile` — no longer needed in agent pod [DEPENDS ON: T009]

## Phase 4: Deploy + Verify

- [x] T013 Apply CRD to cluster — kubectl apply crd.yaml + rbac.yaml, verify with kubectl get crd loretasks.lore.re-cinq.com [DEPENDS ON: T001, T005]
- [x] T014 Build and push claude-runner image — trigger build-claude-runner.yml, verify image in GHCR [DEPENDS ON: T004]
- [x] T015 Deploy updated agent — helm upgrade with controller + watcher, verify LoreTask CR creation on implementation task [DEPENDS ON: T011, T012, T013, T014]
- [x] T016 End-to-end test — submit implementation task, verify Job pod spawns, Claude Code edits files, branch pushed, PR created, Job cleaned up [DEPENDS ON: T015]

## Post-ship additions (not in original spec)

- [x] T017 Review mode in entrypoint — `TASK_TYPE=review` path: checkout PR branch, run Claude Code, parse REVIEW_RESULT structured output (ADR-012)
- [x] T018 Autonomous review loop in watcher — on CHANGES_REQUESTED create new implementation LoreTask on same branch, max 2 iterations (ADR-012)
- [x] T019 Pre-run context hydration — fetch assembled context from /api/context before running Claude Code in both runners (ADR-013)
- [x] T020 Deterministic validation + fix retry — run validation.js after agent edits, one fix-only Claude pass on failure, NEEDS_HUMAN_HELP on second failure (ADR-013)
- [x] T021 Per-task GitHub token Secrets — replace static GITHUB_TOKEN env var with short-lived App installation token in K8s Secret, deleted after Job completion
- [x] T022 Structured log storage — upload pod logs to GCS via log-storage.ts, store URL in LoreTask.status.logUrl (secure-log-storage spec)
- [x] T023 Post-task auto-curation — write episode + Haiku lesson extraction after every terminal outcome (ADR-014)
