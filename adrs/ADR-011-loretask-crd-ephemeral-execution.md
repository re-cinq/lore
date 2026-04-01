---
adr_number: "011"
title: LoreTask CRD for ephemeral Claude Code execution
status: accepted
date: 2026-04-01
domains:
  - architecture
  - agents
  - infrastructure
---

# LoreTask CRD for ephemeral Claude Code execution

## Status

Accepted

## Context

Implementation tasks ran `claude --print` inside the long-lived agent pod. This caused three problems:

1. **CI deploys killed running tasks** — every push to main triggered `build-agent.yml` → deploy → `kubectl rollout restart`, terminating Claude Code mid-execution. Tasks went from `running` to orphaned with no recovery.
2. **No parallelism** — the worker was single-threaded. One Claude Code session blocked the entire agent for 5-15 minutes, queuing all other tasks.
3. **No isolation** — a runaway Claude Code session could OOM the agent pod, taking down task polling, schedulers, and health checks.

## Decision

Introduce a Kubernetes CRD (`LoreTask`, `lore.re-cinq.com/v1alpha1`) with a controller that spawns ephemeral Job pods for implementation tasks. The agent worker creates a LoreTask CR instead of spawning Claude Code in-process. A controller watches CRs, creates Jobs with the `claude-runner` image (minimal container: node + git + claude CLI), and updates CR status on completion. A watcher job in the agent polls for completed LoreTasks and creates PRs from the pushed branches.

Flow: agent creates CR → controller creates Job → Job pod clones repo, runs Claude Code, commits, pushes → controller updates status → agent watcher creates PR.

## Rationale

- **Deploy-safe** — agent pod restarts do not affect running Job pods. Tasks survive CI deploys.
- **Parallel execution** — multiple implementation tasks run as independent Jobs concurrently.
- **Isolated** — each task gets its own pod with defined resource limits (1 CPU, 2Gi). A runaway session cannot crash the agent.
- **Kubernetes-native** — CRDs provide structured status, kubectl visibility, and standard RBAC. No external orchestration system required.

## New Infrastructure

- `terraform/modules/gke-mcp/loretask-crd/` — CRD YAML, controller Deployment, RBAC
- `docker/claude-runner/` — Dockerfile + entrypoint for Job pods
- `.github/workflows/build-claude-runner.yml` — CI for claude-runner image
- `agent/src/jobs/loretask-watcher.ts` — scheduled job that polls completed LoreTasks

## Alternatives Considered

### 1. Fix the deploy pipeline (graceful shutdown)

Add preStop hooks and signal handling so the agent waits for Claude Code to finish before shutting down. This solves the deploy-kill problem but does not address parallelism or isolation. A single OOM-ing session still takes down the entire agent.

### 2. Argo Workflows

Argo provides full DAG-based workflow orchestration with retries, artifacts, and a UI. However, it is a heavy dependency (CRDs, controller, server, UI) for what is fundamentally a simple "run one Job" pattern. The operational burden is disproportionate to the need.

### 3. Plain Jobs without CRD

Create Kubernetes Jobs directly from the agent without a CRD. This works but provides no structured status object — the agent must parse Job conditions and pod logs to determine outcomes. A CRD gives a clean `.status` contract, makes `kubectl get loretasks` useful, and allows future extensions (priority, quotas) without changing the Job-creation logic.

## Consequences

**Positive:**
- Tasks survive agent deploys
- Multiple implementation tasks run in parallel
- Resource isolation per task
- Structured observability via `kubectl get loretasks`

**Negative:**
- Adds Kubernetes operator complexity (CRD, controller, RBAC)
- Controller is a new component to deploy and monitor
- Job pod startup adds ~10s latency compared to in-process spawn
