# Task Breakdown: LoreTask CRD — Ephemeral Claude Code Execution

## Phase 1: CRD + Runner Image

- [x] T001 [P] Define LoreTask CRD YAML in `terraform/modules/gke-mcp/loretask-crd/crd.yaml` — apiVersion lore.re-cinq.com/v1alpha1, spec fields (taskId, prompt, targetRepo, branch, model, timeoutMinutes), status fields (phase, jobName, output, changedFiles, prUrl, failureReason)
- [x] T002 [P] Create claude-runner Dockerfile in `docker/claude-runner/Dockerfile` — node:24-slim + git + GitHub CLI + claude CLI, non-root runner user, WORKDIR /workspace
- [x] T003 [P] Create claude-runner entrypoint `docker/claude-runner/entrypoint.sh` — clone repo, pre-run context hydration from Lore API, run claude with Lore workflow preamble, deterministic validation + retry, git add/commit/push; review mode support
- [x] T004 Create CI workflow `.github/workflows/build-claude-runner.yml` — build and push ghcr.io/re-cinq/lore-claude-runner on changes to docker/claude-runner/ [DEPENDS ON: T002, T003]

## Phase 2: Controller

- [x] T005 Create RBAC manifests in `terraform/modules/gke-mcp/loretask-crd/rbac.yaml` — ServiceAccount, ClusterRole (watch/create/update loretasks, create/list/delete jobs, get/list pods, read pods/log, secrets CRUD), ClusterRoleBinding with Workload Identity annotation [DEPENDS ON: T001]
- [x] T006 Create controller in `agent/src/loretask-controller.ts` — watch LoreTask CRs with phase=Pending via K8s API, create Job with claude-runner image, per-task GitHub App token secrets, resource limits (500m/1Gi req, 1 CPU/2Gi limit), activeDeadlineSeconds from timeoutMinutes [DEPENDS ON: T001, T005]
- [x] T007 Add Job completion monitor to controller — checkJob() monitors Job conditions, parses logs for CHANGES= and REVIEW_RESULT:, streams logs to GCS, sets LoreTask phase=Succeeded/Failed [DEPENDS ON: T006]
- [x] T008 Add cleanup logic — deleteTokenSecret() after Job completion, ttlSecondsAfterFinished:300 on Jobs, watcher removes completed LoreTasks >1h old and cleans orphaned GCS secrets [DEPENDS ON: T007]

## Phase 3: Agent Integration

- [x] T009 Replace `handleClaudeCodeTask` in `agent/src/worker.ts` — creates LoreTask CR via @kubernetes/client-node instead of spawning claude, handles 409 conflicts gracefully [DEPENDS ON: T006]
- [x] T010 Create LoreTask watcher job in `agent/src/jobs/loretask-watcher.ts` — polls completed LoreTasks every 1 min, creates PRs, handles no-changes/failures, Slack notifications, auto-review loop (max 2 iterations), episode writing [DEPENDS ON: T007, T009]
- [x] T011 Register loretask-watcher in agent scheduler `agent/src/index.ts` — `registerJob("loretask_watcher", "*/1 * * * *", loretaskWatcherJob)` [DEPENDS ON: T010]
- [x] T012 Remove claude CLI and git from `agent/Dockerfile` — agent image is Node 22-slim runtime only, no execution tooling [DEPENDS ON: T009]

## Phase 4: Deploy + Verify

- [x] T013 Apply CRD to cluster — crd.yaml, rbac.yaml, agent-rbac.yaml, and controller-deployment.yaml all present in `terraform/modules/gke-mcp/loretask-crd/` [DEPENDS ON: T001, T005]
- [x] T014 Build and push claude-runner image — build-claude-runner.yml triggers on changes to docker/claude-runner/ and repo-validation source files [DEPENDS ON: T004]
- [x] T015 Deploy updated agent — controller runs as standalone Deployment (loretask-controller-main.ts), watcher registered in scheduler [DEPENDS ON: T011, T012, T013, T014]
- [x] T016 End-to-end test — implementation tasks create LoreTask CR, controller spawns Job pod, entrypoint runs Claude Code with full Lore workflow, watcher creates PR and posts Slack notification [DEPENDS ON: T015]
