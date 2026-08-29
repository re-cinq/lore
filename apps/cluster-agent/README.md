# Lore Cluster Agent (`@re-cinq/lore-cluster-agent`)

The **only process in the platform that talks to this cluster's Kubernetes
API**. The Floor holds no Kubernetes client anymore
([ADR-024](../../adrs/ADR-024-ubiquitous-language-execution-model.md),
amendment 2026-08-24): it and lore-api reach pod logs, the recipe catalog, and
per-task token provisioning over HTTP through the shared `ClusterAgentClient`
(`libs/shared/src/cluster/cluster-agent-client.ts`, `CLUSTER_AGENT_URL`). The
agent holds **no database** — callers bring their own state and ask it for
cluster operations only. It runs as the `lore-cluster-agent` Deployment in the
`lore-cluster-agent` namespace, part of the `lore-platform` umbrella Helm chart,
acting on the `ai-agents` namespace where the Agent CRs, the token Secret, and
the catalog live.

**It is not dispatched to.** Work arrives by CLAIM, never by push: the Floor
parks each pod node `queued` in `pipeline.station_runs`, and this process pulls
the ones its tags cover and launches them here. That is true of every
cluster-agent including the central one — see [Registration and the claim
loop](#registration-and-the-claim-loop). The HTTP routes below are what remains:
reads, and the two writes a caller cannot do for itself.

## Design

Every route is a **domain operation, not a Kubernetes verb**. Two of the
underlying interactions are read-modify-write pairs — the Secret key write and
the catalog apply (create → 409 → get → replace) — and exposing `get` and
`replace` separately would invite a caller to split a pair across the network
and lose the update. **No `resourceVersion` ever crosses the
wire.** The pairs themselves live in `src/kernel/paired-writes.ts` as tested
decision logic (conflict-retry ladder, station-first write order), not in the
IO shell.

Other load-bearing choices, each recorded with its incident in
[ADR-024](../../adrs/ADR-024-ubiquitous-language-execution-model.md):

- **One apiserver page per list call**, caller drives `continue`, `limit`
  capped at 100 and refused (not clamped) above that — an accumulated one-shot
  list once blew Node's heap and crash-looped the Floor.
- **`found:false` at 200, never 404**, for a missing CR — a 404 would be
  indistinguishable from the route itself being absent.
- **Token minting happens here**, in-process: every launch is a claim, so the
  claim loop reads the catalog, mints the GitHub App installation token, writes
  the Secret key (409-retried) and clones the per-task recipe pair itself. No
  GitHub token ever crosses the network, and there is no mint ROUTE — only the
  reclaim (`DELETE /per-task-tokens/{taskId}`), which the Floor drives when a
  task settles. The accepted cost is that the App private key lives in this
  service as well as on the Floor.
- **Log tails are clamped server-side** at 10,000 lines, because the Floor's
  clamp no longer protects this process's heap.
- **Errors are read by status, never collapsed**: 404 is absence, 403 names the
  missing Role rule, anything else is a failure (`src/kernel/k8s-errors.ts`).

## Routes

All `/api/cluster/*` routes require the same bearer token every other
service-to-service call presents; `/healthz` is open and deliberately does not
probe the apiserver.

| Route | Operation |
| --- | --- |
| `GET /api/cluster/agents/{name}` | Fetch one CR; `{found:false}` at 200 when absent |
| `GET /api/cluster/agents` | One page of CRs (`limit` ≤ 100, `labelSelector`, `continue`) |
| `DELETE /api/cluster/agents/{name}` | Remove a CR; a lost delete race is a success |
| `GET /api/cluster/agents/{name}/pod-info` | Phase + job name of the CR's pod |
| `GET /api/cluster/jobs/{jobName}/pods` | Pod summaries for a Job |
| `GET /api/cluster/pods/{podName}/log` | Pod log, `tail` clamped to 10,000 lines |
| `DELETE /api/cluster/per-task-tokens/{taskId}` | Remove the per-task token key and recipe pair |
| `POST /api/cluster/catalog/pairs` | Apply an AgentDefinition + Station pair, station first, unowned live fields preserved |
| `DELETE /api/cluster/catalog/pairs/{name}` | Delete a pair, station first — a recipe never points at a missing station |
| `GET /healthz` | Liveness/readiness (no auth, no apiserver probe) |

## Configuration

| Variable | Purpose |
| --- | --- |
| `LORE_API_URL` | **Required.** Central lore-api, for register / claim / heartbeat |
| `LORE_CLUSTER_AGENT_REGISTRATION_TOKEN` | **Required.** Pre-shared token, used once to register |
| `LORE_CLUSTER_AGENT_NAME` | **Required.** This cluster's unique registry name (`central` on the platform's own) |
| `LORE_CLUSTER_AGENT_TAGS` | Capability tags offered, comma-separated (e.g. `node:agent,node:validate`) |
| `LORE_STATION_BACKEND` | Must resolve to `k8s`; in-cluster it does so on its own |
| `PORT` | Listen port (default 8080) |
| `LORE_INGEST_TOKEN` | The bearer token callers must present — same secret on both ends |
| `LORE_AGENTS_NAMESPACE` | Namespace it acts on (default `ai-agents`) |
| `LORE_AGENT_SECRETS_NAME` | Secret holding per-task token keys (default `agent-secrets`) |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_INSTALLATION_ID` | The GitHub App triple used to mint per-task installation tokens |
| `LORE_CLUSTER_AGENT_IDENTITY_SECRET` / `_NAMESPACE` / `_KEY` | Where the registered `{id, token}` persists; local runs fall back to `LORE_CLUSTER_AGENT_IDENTITY_FILE` |

The first three have no defaults and no off switch: the process exits naming
whichever are missing.

## Registration and the claim loop

**Every** cluster-agent registers with the central lore-api and then claims its
work — the one running beside the platform on GKE exactly as much as one on a
laptop's minikube. There is no second mode and no flag: since dispatch flipped
from push to pull (specs/running-stations-in-any-k8s-cluster FR3) the Floor
parks each pod node `queued`, so an agent that did not register would claim
nothing and every run would sit until it died at the queue-wait bound. That
failure is silent, which is why the registration triple is a boot requirement
(`registrationConfig` throws, naming every missing variable) rather than a
quieter startup.

On boot the process registers under `LORE_CLUSTER_AGENT_NAME`, receives a
durable id and a per-agent bearer token, and persists the pair in a Kubernetes
Secret through the API (the container is read-only, so a file write would EROFS
the minted identity into a 409 restart loop). It then polls
`POST /api/cluster-agents/{id}/claim` — taking any queued station run whose
`required_tags` its own tags cover, and launching it as a local Agent CR — with
a 30 s heartbeat beside it, so a long claim never looks like a dead cluster.
Registration *failure* is not fatal: it retries on a 30 s→5 m schedule while the
read routes and the CR watch keep serving.

What differs between clusters is **packaging and credentials**, not behaviour.
The platform's own cluster ships in the `lore-platform` umbrella, reaches
lore-api over in-cluster DNS, and mounts `LORE_INGEST_TOKEN` to report with. A
cluster Lore does not own ships via `charts/cluster-agent-standalone-helm`,
reaches a public URL, and reports with the per-agent token registration minted —
the bus-wide one never leaves the platform (FR5). See the [Platform Engineer
Guide](../../docs/using-lore/platform-engineer.md#register-a-new-execution-cluster-satellite)
for the operator walk-through of the second case.

## Boundaries

Deliberately absent: **no database pool** (no `pg`, no DB credentials in the
chart), **no scheduling or event loop**, **no business logic** — it never
decides *whether* to dispatch, merge, or retry, only performs the cluster
operation it was asked for. The service is stateless and idempotent
(`replicaCount: 1` only because nothing needs more yet), and its `/healthz`
never gates on the apiserver, so a blip does not take it out of rotation
exactly when a caller needs a real error from it.

## Develop

```bash
npm install                                   # from the repo root (workspace member)
npm run build -w @re-cinq/lore-cluster-agent
npm test  -w @re-cinq/lore-cluster-agent      # vitest; buildServer() is driven with inject()
```

Depends on `@re-cinq/lore-shared` and `@re-cinq/agent-contracts` — build the
workspace libs first, or use the root `npm run build` which orders them. The
Kubernetes clients are built lazily on first use, so the server describes
itself without a cluster present.

## Deploy

Built into a container via [`Dockerfile`](./Dockerfile); `CMD` runs
`dist/index.js` on port 8080. Shipped as image
`ghcr.io/re-cinq/lore-cluster-agent` by
[`.github/workflows/build-cluster-agent.yml`](../../.github/workflows/build-cluster-agent.yml)
into the `cluster-agent-helm` subchart of the `lore-platform` umbrella
([`infra/terraform/modules/gke-mcp/lore-platform/charts/cluster-agent-helm`](../../infra/terraform/modules/gke-mcp/lore-platform/charts/cluster-agent-helm)).
The chart's Role carries the `agents`/`agents/status` and `pods/log` verbs the
Floor gave up in the cut.
