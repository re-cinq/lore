# Task Breakdown: LoreTask CRD — Ephemeral Claude Code Execution

> **Status: Shipped** — All phases complete as of 2026-04-06.
> Tasks below updated to reflect actual implementation state.

## Phase 1: CRD + Runner Image

- [x] T001 [P] Define LoreTask CRD YAML in `terraform/modules/gke-mcp/loretask-crd/crd.yaml` — apiVersion lore.re-cinq.com/v1alpha1, spec fields (taskId, prompt, targetRepo, branch, model, timeoutMinutes), status fields (phase, jobName, output, changedFiles, prUrl, failureReason). Shipped with additionalPrinterColumns for kubectl and extra fields: taskType, description, image, reviewResult, parentTaskId.
- [x] T002 [P] Create claude-runner Dockerfile in `docker/claude-runner/Dockerfile` — node:24-slim + git + gh CLI + claude CLI (`@anthropic-ai/claude-code`), non-root runner user, WORKDIR /workspace. Also builds the repo-validation CLI.
- [x] T003 [P] Create claude-runner entrypoint `docker/claude-runner/entrypoint.sh` — clone repo with GITHUB_TOKEN, checkout branch, pre-hydrates context from Lore API, run claude --print --dangerously-skip-permissions, runs deterministic validation (lint/typecheck), git add/commit/push, output CHANGES summary. Supports two modes: `implementation` (default) and `review`.
- [x] T004 Create CI workflow `.github/workflows/build-claude-runner.yml` — build and push ghcr.io/re-cinq/lore-claude-runner on changes to docker/claude-runner/ [DEPENDS ON: T002, T003]

## Phase 2: Controller

- [x] T005 Create RBAC manifests in `terraform/modules/gke-mcp/loretask-crd/rbac.yaml` — ServiceAccount, ClusterRole (watch/create/update loretasks, create/list/delete jobs, get/list pods, read pods/log, read secrets), ClusterRoleBinding. Includes GCP Workload Identity annotation. [DEPENDS ON: T001]
- [x] T006 Create controller in `agent/src/loretask-controller.ts` — watch LoreTask CRs with phase=Pending via K8s API, create Job with claude-runner image, mount secrets (ANTHROPIC_API_KEY, GitHub App creds), set resource limits (1 CPU, 2Gi), set activeDeadlineSeconds from timeoutMinutes [DEPENDS ON: T001, T005]
- [x] T007 Add Job completion monitor to controller — watch Job status, on success read pod logs + extract changed files count + set LoreTask phase=Succeeded, on failure capture logs + set phase=Failed with reason [DEPENDS ON: T006]
- [x] T008 Add cleanup logic — delete Job pods 5 min after LoreTask status is read (ttlSecondsAfterFinished or manual cleanup) [DEPENDS ON: T007]

## Phase 3: Agent Integration

- [x] T009 Replace `handleClaudeCodeTask` in `agent/src/worker.ts` — create LoreTask CR via @kubernetes/client-node instead of spawning claude, set task status to running with job reference [DEPENDS ON: T006]
- [x] T010 Create LoreTask watcher job in `agent/src/jobs/loretask-watcher.ts` — poll completed LoreTasks every 15s, on Succeeded create PR via platform().createPR and update pipeline.tasks, on Failed update pipeline.tasks with failure_reason. Also handles auto-review loop: creates review LoreTasks, handles APPROVED/CHANGES_REQUESTED outcomes, iterates up to 2 rounds, escalates to human on iteration >= 2. [DEPENDS ON: T007, T009]
- [x] T011 Register loretask-watcher in agent scheduler — registered in `agent/src/index.ts` as `loretask_watcher` cron job running every minute (`*/1 * * * *`) [DEPENDS ON: T010]
- [x] T012 Remove claude CLI and git from `agent/Dockerfile` — agent pod uses node:22-slim without claude CLI or git; these live only in the claude-runner image [DEPENDS ON: T009]

## Phase 4: Deploy + Verify

- [x] T013 Apply CRD to cluster — CRD and RBAC deployed to lore-agent namespace [DEPENDS ON: T001, T005]
- [x] T014 Build and push claude-runner image — image available at ghcr.io/re-cinq/lore-claude-runner:latest [DEPENDS ON: T004]
- [x] T015 Deploy updated agent — agent deployed with controller + watcher registered [DEPENDS ON: T011, T012, T013, T014]
- [x] T016 End-to-end test — implementation tasks create LoreTask CRs, Job pods spawn, Claude Code edits files, branches pushed, PRs created, Jobs cleaned up [DEPENDS ON: T015]

## Post-Ship Additions (beyond original spec)

These capabilities were added during implementation and are not reflected in the original task breakdown:

- **Review mode** (`entrypoint.sh`): claude-runner supports a `TASK_MODE=review` path that runs Claude Code to review a PR branch, posts comments via `gh`, and outputs `APPROVED` or `CHANGES_REQUESTED`.
- **Autonomous review loop** (`loretask-watcher.ts`): After an implementation PR is created, the watcher auto-creates a review LoreTask. On `CHANGES_REQUESTED`, it creates a fix implementation LoreTask on the same branch (max 2 iterations). On approval or iteration >= 2, escalates to human.
- **Auto-curation episodes**: Task completion (PR, no-changes, failure) triggers `episode-writer.ts` for passive memory capture. High-signal events get Haiku lesson extraction.
- **GitHub Issue dispatch**: Each task creates a GitHub Issue (`lore-managed` label). Watcher posts status comments and closes the issue when the PR is created.
- **Pre-run context hydration**: `entrypoint.sh` fetches assembled context from `/api/context` before spawning Claude Code, eliminating the cold-start `assemble_context` call.
- **Deterministic validation**: After agent edits, `entrypoint.sh` runs lint/typecheck via `repo-validation-cli.ts`. Validation failure triggers one retry with a fix prompt; if still failing, marks `needs-human-help`.
- **`needs-human-help` status**: New terminal task status set when validation fails after retry. Worktree preserved for debugging.
