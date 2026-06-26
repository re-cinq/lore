# Runbook: Floor-graph driver — minikube smoke test

When to use this runbook: you want to verify the **real Agent-CR round-trip** of the
Floor-side workflow-graph driver (ADR-031 D4, `#686`) — the parts the local integration
test (`apps/floor/src/application/floor-graph-run.test.ts`) deliberately fakes. That test
already proves the orchestration (lease → graph walk → branch-as-state stage commits →
resume → CI loop-back) on a temp git repo. What it does **not** exercise, and what this
runbook does, is the cluster-shaped IO:

- `dispatchAgent` actually creating a per-node `Agent` custom resource,
- the subsystem controller turning each `Agent` into a Job pod that runs,
- `agentStatus` reading that CR's real status back,
- the real `git push` of the stage commits + the branch's CI conclusion.

Plain-language note: minikube is a one-node Kubernetes cluster on your laptop. A *custom
resource* (CR) is just a typed YAML object the cluster stores; the subsystem's
*controller* watches for `Agent` CRs and creates a *Job* (a run-once pod) for each.

## Prerequisites

- `minikube start` (running) and `kubectl`/`helm` on PATH.
- The ai-agent-subsystem controller image (build it in that repo, then load it so the
  in-laptop cluster can see it without a registry):

  ```bash
  # in re-cinq/ai-agent-subsystem (no root Dockerfile — point -f at the controller recipe;
  # context is the repo root, since the build does `COPY . .` + `dub build :controller`)
  docker build -f deploy/Dockerfile.controller -t ghcr.io/re-cinq/ai-agent-controller:smoke .
  minikube image load ghcr.io/re-cinq/ai-agent-controller:smoke
  ```

- An Anthropic API key and a GitHub token with push + PR scope on a throwaway test repo.

## 1. Deploy the subsystem to minikube

The `ai-agents-helm` chart (from `#682`) ships the CRDs, controller, RBAC, the seeded
catalog (`#699`), and the per-recipe telemetry sink (`#687`).

```bash
cd infra/terraform/modules/gke-mcp
helm install ai-agents ./ai-agents-helm \
  --namespace ai-agents --create-namespace \
  --set-string agentEventsUrl=http://host.minikube.internal:8080/api/agent-events \
  --set seedCatalog=true

# The chart pins the controller by DIGEST (templates/controller.yaml renders
# `repository@digest` — there is NO image.tag path), so a `--set controller.image.tag`
# is silently ignored and the pod ImagePullBackOffs on the unreachable prod digest.
# Repoint the running Deployment at the locally-loaded :smoke tag (imagePullPolicy is
# IfNotPresent, so kubelet uses the `minikube image load`ed image, no registry pull):
kubectl -n ai-agents set image deployment/agent-controller \
  controller=ghcr.io/re-cinq/ai-agent-controller:smoke
kubectl -n ai-agents rollout status deployment/agent-controller

kubectl -n ai-agents get pods                       # controller Running
kubectl -n ai-agents get agentdefinitions,stations  # the seeded catalog (one per task type)
```

`agentEventsUrl` is baked into the seeded recipes at install time (templates/catalog.yaml),
so it must be overridden here, not exported later — the default points at the in-cluster
prod DNS name (`lore-floor.lore-floor.svc`) that doesn't exist on minikube.

## 2. Provide the run secrets

The run pods read allowlisted keys from the single `agent-secrets` Secret (the chart
expects ESO in prod; on minikube we create it by hand):

```bash
kubectl -n ai-agents create secret generic agent-secrets \
  --from-literal=ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"
# the per-task GitHub token (#697) is PATCHed in at dispatch by the Floor.
```

## 3. Run the Floor against minikube

Point the Floor at the laptop cluster and flip on the Agent-CR backend. The driver's
ports resolve to: `dispatchAgent` → `AgentBackend.launch`, `agentStatus` → the per-node CR
read, `ciConclusion` → `project.pulls`, lease → `DbLeaseBackend`.

```bash
export KUBECONFIG="$HOME/.kube/config"          # minikube context active
export LORE_AGENTS_NAMESPACE=ai-agents
export LORE_AGENT_CR_BACKEND_ENABLED=true        # cluster gate (ADR-031 two-gate)
export LORE_AGENT_INTERNAL_TOKEN=smoke-token      # Bearer the /api/agent-events sink requires
npm start                                        # or: npm run -w @re-cinq/lore-floor start
```

## 4. Trigger a graph task + watch

Create an `implementation` task against the throwaway repo (UI `/onboard` → task, MCP
`lore_create_pipeline_task`, or `POST /api/tasks`). Then watch the round-trip:

```bash
# One Agent CR PER agent-node (impl.yaml has 4) — names are <taskId8>-<nodeId>:
kubectl -n ai-agents get agents -w
kubectl -n ai-agents get jobs,pods               # a Job pod per dispatched Agent
kubectl -n ai-agents logs -l lore.re-cinq.com/task-id=<taskId> --tail=50

# Branch-as-state: stage commits land on the task branch with trailers.
git -C <clone-of-test-repo> log --format='%s%n%b' origin/<task-branch> | grep Lore-Stage
```

## Verification checklist

- [ ] **Per-node dispatch** — `kubectl get agents` shows one CR per agent-node, named
      `<taskId8>-<nodeId>` (proves `nodeAgentSpec` + the `dispatchAgent` port).
- [ ] **Controller reconcile** — each `Agent` produced a Job pod that ran to `Succeeded`.
- [ ] **Status read-back** — the node advanced only after its Agent reached a terminal
      phase (proves the `agentStatus` per-node `poll(taskId, nodeId)` contract).
- [ ] **Branch-as-state** — `Lore-Stage:` / `Lore-Task:` trailers are on the pushed
      branch, one per executed node.
- [ ] **CI gate** — a `github_action` node blocked until the branch's CI concluded.
- [ ] **Telemetry** — `pipeline.llm_calls` gained rows for the run (`#687` sink).
      **Known gap (expect 0 rows today):** run pods POST NDJSON to `/api/agent-events`
      with no `Authorization` header — the subsystem parses each recipe's
      `headers_secret: agent-events-auth` but never applies it to the outgoing request
      (no header wiring in `agentcore/output`), so the Floor's `authInternal` 401s every
      event. This clears once the subsystem implements `headers_secret` → `Authorization`
      (the v0.3.0 path the chart's digest TODO tracks).
- [ ] **Lease** — `pipeline.task_leases` is empty after completion (released cleanly).

## Teardown

```bash
helm uninstall ai-agents -n ai-agents
kubectl delete namespace ai-agents
minikube stop
```

## Notes

- This is the manual gate before flipping the rollout in prod. The graded cutover +
  LoreTask teardown is `#688` (`runbooks/dark-factory-rollback.md` covers the revert).
- If an `Agent` never produces a Job, check the controller logs and that
  `agentdefinitions`/`stations` for the task type exist (`kubectl -n ai-agents get
  stations`). A missing catalog entry is the usual cause.
- **Empty catalog (`No resources found`) despite a Running controller?** The catalog is
  plain CRs gated by `{{ if .Values.seedCatalog }}` — they only get created by an actual
  `helm install/upgrade`. If the controller + CRDs were bootstrapped outside Helm (`helm
  list -A` shows no release), the seed block never rendered. A full `helm install` now
  collides with the existing `agent-controller` Deployment, so seed just the catalog:

  ```bash
  helm template ai-agents ./ai-agents-helm --namespace ai-agents --set seedCatalog=true \
    --set-string agentEventsUrl=http://host.minikube.internal:8080/api/agent-events \
    --show-only templates/catalog.yaml | kubectl -n ai-agents apply -f -
  ```
- Only the **controller** image is built/loaded above. The run-pod **agentImage**
  (`controller.agentImage` in values.yaml) stays pinned to its prod digest, pulled from
  ghcr — so that package must be public or a `ghcr-pull-secret` must exist in the
  `ai-agents` namespace, else run pods `ImagePullBackOff`. To smoke-test *agent-side*
  changes (e.g. the events-sink auth above), build + `minikube image load` the agent
  image too and add `--set-string controller.agentImage=ghcr.io/re-cinq/ai-agent:smoke`.
- Long-term fix for the digest-only `kubectl set image` dance: give the chart a
  `controller.image.tag` fallback used when `digest` is empty (keeps prod digest-pinned,
  unblocks local smoke builds).
