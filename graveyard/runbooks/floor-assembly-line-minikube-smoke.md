# Runbook: run Lore + the ai-agent-subsystem locally on minikube

When to use this runbook: you want a laptop that executes **real tasks** end-to-end —
Floor → `Agent` CR → controller → run pod → PR — instead of the lightweight in-process
path. This is the local counterpart of the GKE deploy, and the manual gate before
flipping anything in prod (`runbooks/floor-assembly-line-gke-cutover.md`).

Plain-language note: **minikube** is a one-node Kubernetes cluster on your laptop. A
*custom resource* (CR) is just a typed YAML object the cluster stores; the subsystem's
*controller* watches for `Agent` CRs and creates a *Job* (a run-once pod) for each. A
*Secret* is a namespaced blob of key/values a pod can mount as env vars.

## The topology (hybrid)

The app processes stay on your host, as usual — only the agent execution substrate goes
in the cluster:

| Runs where | What |
|---|---|
| Host (`npm start`) | web-ui :3000, lore-api :3001, Floor :8080; Postgres :5432 + Dgraph :8081 in Docker |
| minikube | the ai-agent-subsystem: CRDs, controller, seeded catalog, and the run pods |

Two consequences follow, and everything else is detail:

- **The Floor reaches the cluster through your kubeconfig.** In GKE the Floor is a pod
  and reads its service account; on your laptop it has none, so it loads
  `LORE_KUBECONFIG`, else `KUBECONFIG`, else `~/.kube/config`
  (`libs/shared/src/kube-config.ts`).
- **Run pods reach back to your host at `host.minikube.internal`.** The chart's defaults
  point at in-cluster DNS (`lore-floor.lore-floor.svc…`), which doesn't exist here, so
  `values.minikube.yaml` repoints the agent-events sink, the Lore API, and Dgraph at the
  host. It also disables the run-pod NetworkPolicy: that policy denies all RFC1918 egress
  except the in-cluster Floor/API, and locally those *are* RFC1918 — it would drop exactly
  the traffic that must work. (minikube's default CNI doesn't enforce NetworkPolicy
  anyway, so applying it would only advertise a posture that isn't running.)

## Prerequisites

- `minikube`, `kubectl`, `helm` on PATH.
- A GitHub PAT with `read:packages` — the controller + agent-runtime images are **private**
  ghcr packages from `re-cinq/ai-agent-subsystem`, not built from this repo.
- An Anthropic API key, and the Lore GitHub App creds (the Floor mints per-task tokens
  from the App to clone/push/open PRs).
- A throwaway repo onboarded to Lore to aim tasks at.

## 1. Configure

Copy `.env.local.example` to `.env.local` and fill in:

```bash
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_APP_ID=...
GITHUB_APP_INSTALLATION_ID=...
GITHUB_APP_PRIVATE_KEY=...

LORE_STATION_BACKEND=k8s      # opt in — without this you get the in-process path
GHCR_USER=your-github-username
GHCR_TOKEN=ghp_...            # read:packages
```

`.env.local` is the single source of truth: `npm start` sources it, and the bootstrap
script materializes the cluster Secrets from it. Nothing is hand-written into the cluster.

## 2. Start

```bash
minikube start
npm start
```

Because `LORE_STATION_BACKEND=k8s`, `npm start` runs
`scripts/infra/setup-minikube-agents.sh` before booting the stack. That script is
idempotent and does what terraform + ESO do on GKE:

1. creates the `ai-agents` namespace,
2. creates `ghcr-pull-secret` **and binds it to the namespace's `default` ServiceAccount**
   — run pods are created under that SA, and the chart's `imagePullSecrets` only covers
   the controller, so without this every run `ImagePullBackOff`s,
3. merges `agent-secrets` (`ANTHROPIC_API_KEY`, `LORE_INGEST_TOKEN`,
   `LORE_AGENT_INTERNAL_TOKEN`, `agent-events-auth`),
4. applies the CRDs,
5. `helm upgrade --install`s the chart with `values.minikube.yaml`.

You can also run it standalone: `bash scripts/infra/setup-minikube-agents.sh`.

## 3. Verify the cluster came up

```bash
kubectl -n ai-agents get deploy                     # agent-controller Ready 1/1
kubectl -n ai-agents get agentdefinitions,stations  # the seeded catalog, one per task type
```

And in the `npm start` output, the Floor should log `[events] k8s Agent-CR watch started`
— that line proves the kubeconfig loaded and the terminal-event watch is live. If it says
`k8s watch disabled (station backend is not k8s)`, `LORE_STATION_BACKEND` never reached the
process.

## 4. Run a task and watch the round-trip

Create a task against the throwaway repo (UI, MCP `lore_create_pipeline_task`, or
`POST /api/tasks` on :3001), then:

```bash
# One Agent CR per agent-node, named <taskId8>-<nodeId>:
kubectl -n ai-agents get agents -w
kubectl -n ai-agents get jobs,pods
kubectl -n ai-agents logs -l lore.re-cinq.com/task-id=<taskId> --tail=50
```

### Checklist

- [ ] **Dispatch** — `kubectl get agents` shows a CR per node (the Floor's kubeconfig works).
- [ ] **Reconcile** — each `Agent` produced a Job pod that ran to `Succeeded`.
- [ ] **Clone** — pod logs show the repo cloned (the per-task GitHub token was PATCHed into
      `agent-secrets` and the ghcr pull secret worked).
- [ ] **Advance** — nodes advanced on terminal phase (the watch is emitting events).
- [ ] **PR** — the Floor's `agent-watcher` opened a PR on the target repo.
- [ ] **Telemetry** — `pipeline.llm_calls` gained rows (run pods POSTed to the host sink at
      `host.minikube.internal:8080` with the `agent-events-auth` header line).

## Teardown

```bash
helm uninstall ai-agents -n ai-agents
kubectl delete namespace ai-agents
minikube stop
```

## Notes / troubleshooting

- **Every run pod `CreateContainerConfigError`.** A key the recipe declares is missing from
  `agent-secrets` — the controller injects them as *non-optional* secretKeyRefs. Re-run the
  bootstrap script. Note `agent-events-auth` must be the whole
  `Authorization: Bearer <token>` line, not a bare token: the supervisor sends the value
  verbatim as HTTP header lines, so a bare token renders no header and the Floor 401s every
  telemetry event.
- **Run pods `ImagePullBackOff`.** The pull secret isn't on the `default` ServiceAccount of
  the `ai-agents` namespace (`kubectl -n ai-agents get sa default -o yaml`), or the PAT
  lacks `read:packages`.
- **Empty catalog despite a Running controller.** The catalog is plain CRs gated by
  `{{ if .Values.seedCatalog }}` — they're only created by an actual `helm install/upgrade`.
  If the CRDs/controller were bootstrapped outside Helm (`helm list -A` shows no release),
  the seed block never rendered.
- **An `Agent` never produces a Job.** Check the controller logs and that the task type's
  `agentdefinitions`/`stations` exist. A missing catalog entry is the usual cause.
- **`npm start` fights your other checkout.** The Docker container names (`lore-postgres`,
  `lore-dgraph`) and ports are fixed, and `free_stale_ports()` kills whatever holds
  3000/3001/8080 — only run one Lore stack at a time.
- **Hacking on the subsystem itself?** The chart pins the controller by DIGEST
  (`templates/controller.yaml` renders `repository@digest`; there is no `image.tag` path),
  so `--set controller.image.tag` is silently ignored. Build in `re-cinq/ai-agent-subsystem`,
  `minikube image load` it, then repoint the Deployment:

  ```bash
  docker build -f deploy/Dockerfile.controller -t ghcr.io/re-cinq/ai-agent-controller:smoke .
  minikube image load ghcr.io/re-cinq/ai-agent-controller:smoke
  kubectl -n ai-agents set image deployment/agent-controller \
    controller=ghcr.io/re-cinq/ai-agent-controller:smoke
  ```

  The run-pod `agentImage` is a separate digest-pinned image; override it with
  `--set-string controller.agentImage=...` if you're testing agent-side changes. Controller
  and agent ship as a **pair** — don't mix versions.
