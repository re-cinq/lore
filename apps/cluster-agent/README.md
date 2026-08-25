# Lore Cluster Agent (`@re-cinq/lore-cluster-agent`)

The **only process in the platform that talks to this cluster's Kubernetes
API**. The Floor holds no Kubernetes client anymore
([ADR-024](../../adrs/ADR-024-ubiquitous-language-execution-model.md),
amendment 2026-08-24): it and lore-api reach Agent-CR dispatch, pod logs, the
recipe catalog, and per-task token provisioning over HTTP through the shared
`ClusterAgentClient` (`libs/shared/src/cluster/cluster-agent-client.ts`,
`CLUSTER_AGENT_URL`). The agent holds **no database** — callers bring their own
state and ask it for cluster operations only. It runs as the `lore-cluster-agent`
Deployment in the `lore-cluster-agent` namespace, part of the `lore-platform`
umbrella Helm chart, acting on the `ai-agents` namespace where the Agent CRs,
the token Secret, and the catalog live.

## Design

Every route is a **domain operation, not a Kubernetes verb**. Three of the
underlying interactions are read-modify-write pairs — the status subresource,
the Secret key write, the catalog apply (create → 409 → get → replace) — and
exposing `get` and `replace` separately would invite a caller to split a pair
across the network and lose the update. **No `resourceVersion` ever crosses the
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
- **Token minting happens here**: `POST /per-task-tokens` reads the catalog,
  mints the GitHub App installation token, writes the Secret key (409-retried),
  and clones the per-task recipe pair in one call, so no GitHub token ever
  crosses the network. The accepted cost is that the App private key lives in
  this service as well as on the Floor.
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
| `POST /api/cluster/agents` | Create an Agent CR; an existing CR reports `created:false`, so a redelivered dispatch is idempotent |
| `GET /api/cluster/agents/{name}` | Fetch one CR; `{found:false}` at 200 when absent |
| `GET /api/cluster/agents` | One page of CRs (`limit` ≤ 100, `labelSelector`, `continue`) |
| `DELETE /api/cluster/agents/{name}` | Remove a CR; a lost delete race is a success |
| `PATCH /api/cluster/agents/{name}/status` | Status read-modify-write, retried on conflict — the loser merges onto the winner's status |
| `GET /api/cluster/agents/{name}/pod-info` | Phase + job name of the CR's pod |
| `GET /api/cluster/jobs/{jobName}/pods` | Pod summaries for a Job |
| `GET /api/cluster/pods/{podName}/log` | Pod log, `tail` clamped to 10,000 lines |
| `POST /api/cluster/per-task-tokens` | Catalog read → GitHub mint → Secret key write → per-task recipe clone, in one call |
| `DELETE /api/cluster/per-task-tokens/{taskId}` | Remove the per-task token key and recipe pair |
| `POST /api/cluster/catalog/pairs` | Apply an AgentDefinition + Station pair, station first, unowned live fields preserved |
| `DELETE /api/cluster/catalog/pairs/{name}` | Delete a pair, station first — a recipe never points at a missing station |
| `GET /healthz` | Liveness/readiness (no auth, no apiserver probe) |

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port (default 8080) |
| `LORE_INGEST_TOKEN` | The bearer token callers must present — same secret on both ends |
| `LORE_AGENTS_NAMESPACE` | Namespace it acts on (default `ai-agents`) |
| `LORE_AGENT_SECRETS_NAME` | Secret holding per-task token keys (default `agent-secrets`) |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_INSTALLATION_ID` | The GitHub App triple used to mint per-task installation tokens |

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
