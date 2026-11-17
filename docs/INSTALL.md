# Installing Lore

Lore runs on one Kubernetes cluster as four parts: **Lore** itself (API, web UI, stations, MCP gateway), the **floor** (the engine that runs agent pods), the **agent subsystem** (the controller that turns a run into a pod) and **Utopia** (the knowledge graph Lore mirrors specs and ADRs into).

| You are | Go to |
| ------- | ----- |
| Installing on a client's cluster | [Section 3](#3-install-on-a-client-cluster): one Helm command, after the infra team has provided section 1 |
| The infra team preparing that cluster | [Section 1](#1-prerequisites), the checklist, and [section 2](#2-cluster-add-ons) |
| The GitHub organization owner | [GitHub setup](github-setup.md): the App, the OAuth App and the registry token |
| Working on re:cinq's own cluster | [Section 4](#4-our-own-gke-with-argo-cd): Argo CD deploys it, nobody runs Helm |
| A developer who wants Lore in Claude Code | [Section 6](#6-install-on-a-developer-laptop) |

Where the parts land:

| Part | Chart | Namespace on a client cluster | Namespace on our GKE |
| ---- | ----- | ----------------------------- | -------------------- |
| Lore | `deploy/chart` in this repo | `lore-api`, `lore-ui`, `lore-stations`, `lore-dgraph` | the same, plus `lore-db` |
| The floor | `oci://ghcr.io/re-cinq/charts/floor` ([re-cinq/floor](https://github.com/re-cinq/floor)) | `lore-floor` | `floor` |
| The agent subsystem, and the agent pods | bundled in the floor chart on a client cluster | `lore-floor` | `ai-agents` |
| Utopia, with its own Postgres | `deploy/chart` in [re-cinq/utopia](https://github.com/re-cinq/utopia) | `lore-floor` | `utopia` |

On a client cluster the four are one release of the `deploy/install` chart.

## 1. Prerequisites

Everything below must exist before the Lore team runs the install in section 3. Each item says who provides it: the **infra team** (cluster, cloud, networking, databases) or the **Lore team** (everything applied with Helm or kubectl inside the Lore and floor namespaces). The right-hand notes say how our own GKE reference install provides it; on another cloud the infra team substitutes.

### 1.1 Cluster

| Need | Value | Why |
| ---- | ----- | --- |
| Kubernetes | 1.27 or newer | the ai-agent-subsystem chart's minimum |
| Helm | 3.8 or newer | the floor chart is an OCI chart |
| Node architecture | amd64 or arm64 | every image is multi-arch (see [Running on ARM64](#running-on-arm64)) |
| Network plugin | one that **enforces NetworkPolicy** (GKE Dataplane V2, Azure CNI with Azure NPM, Calico, Cilium) | agent pods run code a model wrote a minute ago; their egress policy is the only wall. On a plugin that does not enforce, the policy is accepted and binds nothing |
| Pod Security | `baseline` is enough on the namespace agent pods run in (`lore-floor`) | the run pod's init container runs as root to set up the workspace; floor's own pods run as uid 1000, read-only root filesystem |
| Cluster-admin, once | to install the CRDs: ai-agent-subsystem (`agents`, `agentdefinitions`, `stations`.agents.re-cinq.com), CloudNativePG, External Secrets, cert-manager, prometheus-operator | CRDs are cluster-scoped |
| Namespace admin for the Lore team | `lore-floor`, `lore-api`, `lore-ui`, `lore-stations`, `lore-dgraph` (+ `lore-db` for an in-cluster Postgres) | the Helm release and every kubectl apply stay inside these |
| NodeLocal DNSCache | tell us its address if the cluster runs one (GKE: `169.254.20.10`) | it answers on a link-local address the agent-pod egress policy must open explicitly, or pods resolve nothing |

### 1.1.1 Resources to reserve

**Recommended for a first install with up to 5 agents running at once:**

| What | Reserve | Why this size |
| ---- | ------- | ------------- |
| Platform node pool | 3 nodes of 8 vCPU / 32 GiB (Azure: `Standard_D8s_v5`) | everything except agent pods, at its limits, is 12.75 vCPU and 29.5 GiB: two nodes hold it and the third covers losing one. Dgraph alone may use 16 GiB, Utopia's database 8 GiB |
| Agent node pool | 2 nodes of 8 vCPU / 32 GiB, autoscaling up, OS disk 128 GiB or more | 5 agents at their memory limit are 40 GiB, and each uses up to 6 GiB of node disk for its checkout |
| Postgres (managed) | 2 vCores, 8 GiB memory, 50 GiB storage, one server for both databases | what our own in-cluster database is limited to (2 CPU, 4 GiB, 50 GiB), with room for the second database |
| Persistent volumes | ReadWriteOnce: 50 GiB for Dgraph, 80 GiB for Utopia's database, 20 GiB for Utopia's files (+ 10 GiB for Prometheus, if used) | |
| Public IPs | 1, on the ingress controller | five hostnames share it |

These are sizing recommendations worked out from the requests and limits below, not measurements from a client cluster. One pool of the same total size works too; two pools keep an agent that fills its memory away from the database of record.

**For another number of agents.** Each running agent is one pod. Lore's shipped agents come in two sizes:

| Agent size | CPU request | Memory request / limit | Node disk |
| ---------- | ----------- | ---------------------- | --------- |
| Large (implementation, code review and similar) | 500m | 2Gi / 8Gi | 6Gi |
| Small (planning checks and similar) | 500m | 512Mi / 2Gi | 2Gi to 4Gi |

For N agents at once, the agent pool needs at least N × 0.5 vCPU and N × 2 GiB to schedule them, and N × 8 GiB to be safe when they all run large jobs.

**The smallest cluster that starts.** The platform requests 3.65 vCPU and 13.6 GiB in total (1.4 vCPU and 5.1 GiB without Utopia), plus 0.5 vCPU and 2 GiB per running agent. A cluster this small schedules everything and then runs out of memory under load: use it for a trial, not for work.

**What each workload asks for**, as shipped:

| Workload | Replicas | CPU request / limit | Memory request / limit | Disk |
| -------- | -------- | ------------------- | ---------------------- | ---- |
| lore-api | 1 | 100m / 2 | 256Mi / 1Gi | |
| lore-mcp-gateway | 1 | 100m / 500m | 256Mi / 512Mi | |
| lore-ui (+ a migrate Job per deploy) | 1 | 100m / 500m | 256Mi / 512Mi | |
| lore-stations (+ 5 small CronJobs) | 1 | 50m / 500m | 256Mi / 512Mi | |
| Dgraph standalone v24 | 1 | 1 / 4 | 4Gi / 16Gi | 50Gi |
| subsystem controller | 1 | 50m / 250m | 128Mi / 1Gi | |
| floor api | 2 | none set | none set | |
| floor cluster agent | 1 | none set | none set | |
| utopia | 1 | 250m / 1 | 512Mi / 2Gi | 20Gi |
| utopia-db, Postgres 16 with CloudNativePG | 1 | 2 / 4 | 8Gi / 8Gi | 80Gi |
| lore-db, Postgres 16 + pgvector (only when run in-cluster with CloudNativePG) | 1 | 500m / 2 | 1Gi / 4Gi | 50Gi |
| agent pods | N | 500m / none | 512Mi to 2Gi / 2Gi to 8Gi | 2Gi to 6Gi of node disk each |
| optional: Prometheus + Grafana | | 250m+100m / 2Gi+1Gi | | 10Gi |

Where this comes from: `helm template lore deploy/install` for the Lore, floor and Utopia rows, `deploy/chart/templates/lore-db.yaml` for the in-cluster database, and `pod_resources` in `libs/shared/src/agent-defaults/*.md` for the agents (26 of the 32 shipped agents set it; the rest take the floor's default).

### 1.2 Cluster add-ons (infra team)

These are **assumed, not installed**, by Lore's chart; on our GKE they come from re-cinq/infrastructure. The infra team installs them, or agrees that the Lore team may.

| Add-on | What Lore needs from it | Our GKE value |
| ------ | ----------------------- | ------------- |
| Ingress controller | ingress-nginx. The Lore ingresses use nginx annotations (`rewrite-target`, `proxy-body-size`, WebSocket read/send timeouts of 3600 s). The IngressClass name is a value we set | class `nginx-ingress` |
| cert-manager | a `ClusterIssuer` that issues public certificates for the hostnames in 1.4 | `letsencrypt-prod` |
| DNS | A records for the hostnames in 1.4, pointing at the ingress controller's public IP. external-dns reading the `external-dns.alpha.kubernetes.io/hostname` annotation, or records made by hand | external-dns |
| CloudNativePG operator | **required**: Utopia runs its own database with it (`clusters.postgresql.cnpg.io`). Lore's own database can use it too (1.3); backups to object storage need its barman-cloud plugin | CNPG operator in a shared namespace (`cnpg_operator_namespace`), plugin v0.11.0 (re-cinq/infrastructure) |
| Secret store | optional. External Secrets Operator with a `ClusterSecretStore` on the client's vault, or the infra team hands the Lore team the values and we create plain Secrets (1.5) | ESO + GCP Secret Manager, `ClusterSecretStore/gcp-secret-manager` (re-cinq/infrastructure) |
| Metrics | optional. kube-prometheus-stack; every Lore service and the floor serve Prometheus text on a `metrics` port (:9464). The install in section 3 installs neither Prometheus nor Grafana; `lore-platform.platform.monitoring.enabled: true` turns on the ServiceMonitors when kube-prometheus-stack is on the cluster | `enable_monitoring` ([ADR-050](../adrs/ADR-050-prometheus-grafana-metrics.md)) |

### 1.3 Databases and disks (infra team)

| Need | Spec | Notes |
| ---- | ---- | ----- |
| **Lore Postgres** | PostgreSQL 16, an empty database `lore` owned by the role `lore` (no superuser needed), reachable from the Lore namespaces, with pgvector 0.5 or newer (for HNSW indexes): the extension `vector` allow-listed on the server and either created in the database already or creatable by `lore` | in-cluster: a CloudNativePG `Cluster`, 1 instance, 50Gi, image `ghcr.io/cloudnative-pg/postgresql:16-bookworm` (what `scripts/infra/setup-db.sh` creates, extension included). Managed: Azure Database for PostgreSQL Flexible Server with `vector` allow-listed in `azure.extensions`, or RDS/Cloud SQL with pgvector. Lore's schema is installed by the migrations hook on the first `helm install` and updated by it on every deploy (3.4). Whether `lore` may create `vector` itself on Azure is unverified; the safe step is for a server admin to run `CREATE EXTENSION IF NOT EXISTS vector;` in database `lore` once |
| **floor Postgres** | a **second database and role**, never shared with Lore: floor owns its schema (tables `events`, `blobs`, `definitions`) and migrates it on every install. Any Postgres; the role may create tables | the same server is fine. The floor chart never deploys one ([floor install doc](https://github.com/re-cinq/floor/blob/main/docs/install.md)) |
| **Dgraph** | one StatefulSet, `dgraph/standalone:v24.0.0`, 50Gi ReadWriteOnce volume, 4Gi to 16Gi memory | the spec-traceability and memory graphs. The chart renders it from `platform.dgraph` |
| Backups | in-cluster Postgres: an object-storage bucket for barman (GCS, S3 or Azure Blob) with write access from the `lore-db` namespace; managed Postgres: its own backups | ours: GCS bucket, 30-day lifecycle, daily `ScheduledBackup` at 02:00 |
| StorageClass | any ReadWriteOnce class for the two 50Gi volumes (and 10Gi for Prometheus) | ours: `standard-rwo` (pd-balanced) |

Not needed off GCP: the task-log bucket and its KMS key (re-cinq/infrastructure). Only the laptop task runner writes it; leave `LORE_LOG_BUCKET` unset.

### 1.4 Network, DNS and TLS (infra team)

Public hostnames, one certificate each:

| Hostname (our variable) | Serves | Who must reach it from outside |
| ----------------------- | ------ | ------------------------------ |
| `lore_api_url` | the Lore REST API and the browser's live WebSocket at `/api/ws` | developer laptops (the local MCP server proxies everything here), CI (`lore-code-trace`, spec ingest), Slack, browsers |
| `lore_ui_hostname` | the web UI | browsers |
| `lore_event_router_hostname` | the **canonical GitHub webhook URL**, `https://<host>/api/events`, rewritten by the ingress onto lore-api's `POST /api/webhook/github` ([ADR-044](../adrs/ADR-044-event-router-owns-the-event-bus.md)) | GitHub |
| the Utopia hostname | Utopia's UI and API, and its sign-in callback | browsers |
| `lore_mcp_url` | the MCP gateway for agents outside the cluster | optional. Agent pods in the cluster use the in-cluster Service instead (below) |
| `lore_webhook_hostname` | legacy alias of the webhook URL | only for repositories onboarded before ADR-044; a new install leaves it empty |
| floor | none by default; the floor API is a ClusterIP Service | only if a second cluster joins the floor |

In-cluster paths that NetworkPolicies must allow:

| From | To | Port |
| ---- | -- | ---- |
| agent pods (label `agents.re-cinq.com/component: job`, namespace `lore-floor`) | cluster DNS, and NodeLocal DNSCache if present | 53 |
| agent pods | the public internet (github.com, api.anthropic.com, generativelanguage.googleapis.com, npm, ghcr.io; with Microsoft Foundry, `*.openai.azure.com` and `*.services.ai.azure.com`), private ranges and the cloud metadata address excluded | 443 |
| agent pods | floor api pods, same namespace | 8080 |
| agent pods | `lore-mcp-gateway` in `lore-api` (the MCP server and the skills registry the pod fetches at start) | 8080 |
| lore-api, lore-stations | floor api (`http://lore-floor-api.lore-floor.svc.cluster.local:8080`) | 8080 |
| lore-ui, lore-stations, lore-mcp-gateway | lore-api (`http://lore-api.lore-api.svc.cluster.local:3000`) | 3000 |
| lore-api, lore-ui, lore-stations | Postgres; lore-api also Dgraph (`:8080`) | 5432, 8080 |

On a self-hosted GitHub Enterprise Server the second row's `github.com` is the server's host (see [1.6.1](#161-github-enterprise)); a server on a private address needs its own rule in `floor.agentNetworkPolicy.extraEgress`, because the policy excludes the private ranges. The same holds for a Foundry resource reached through a private endpoint.

The floor chart renders the first three rows; the fourth is its `agentNetworkPolicy.extraEgress`, which `deploy/install/values.yaml` sets. Nothing may reach an agent pod. Agent pods do not use the public MCP hostname: on a plugin that short-circuits a public VIP back into the cluster, the post-NAT private address is dropped by the policy's private-range exclusion, so the pod hangs. Whatever stands between lore-api and the floor API must pass WebSocket upgrades and not close a connection idle for under 30 s (the floor pings every 25).

### 1.5 Secrets

The install in section 3 creates every Secret below from the values file (`secrets:`), so on a client cluster this is a reference, not a to-do list. It becomes a to-do list with `secrets.create: false`, when a vault provides them: the Secrets must then exist with exactly these names and keys, in these namespaces. On our GKE, ESO mirrors them from the vault (`platform.externalSecrets` in `deploy/clusters/internal-cluster.values.yaml`, rendered by `deploy/chart/templates/externalsecrets.yaml`). Generation hints and the rotation procedure: [managing-secrets.md](managing-secrets.md).

**Lore, required.** The source column is the name in our GCP Secret Manager, which `scripts/infra/seed-secrets.sh` prompts for.

| Namespace | Secret | Keys | Source | What it is |
| --------- | ------ | ---- | ------ | ---------- |
| `lore-api` | `lore-api-db-password` | `password` | `lore-db-password` | the `lore` Postgres role's password |
| `lore-ui` | `lore-db-password` | `password` | same | |
| `lore-stations` | `lore-stations-db-password` | `password` | same | |
| `lore-api`, `lore-stations` | `lore-ingest-token` | `token` | `lore-ingest-token` | the shared API bearer token (`openssl rand -hex 32`). Laptops and CI use it too |
| `lore-api`, `lore-stations` | `lore-agent-internal-token` | `token` | `lore-agent-internal-token` | the token stations present to lore-api |
| `lore-api`, `lore-ui` | `github-app-credentials` | `app-id`, `private-key`, `installation-id` | `lore-github-app-*` | the GitHub App (1.6) |
| `lore-stations` | `lore-stations-github-app` | same three | same | |
| `lore-api` | `lore-webhook-secret` | `secret` | `lore-webhook-secret` | HMAC secret of the GitHub webhooks |
| `lore-api` | `lore-anthropic-key` | `anthropic-api-key` (+ `anthropic-admin-key`, optional, cost sync) | `lore-anthropic-api-key` | the model key lore-api's own jobs use (fact extraction, triage, evals) |
| `lore-stations` | `lore-stations-anthropic-key` | same | same | |
| `lore-api` | `lore-slack-credentials` | `signing-secret`, `bot-token` | `lore-slack-*` | the Slack app (1.6). Optional: the charts tolerate its absence |
| `lore-stations` | `lore-stations-slack` | `bot-token` | `lore-slack-bot-token` | |
| `lore-api` | `lore-github-oauth` | `client-id`, `client-secret` | `lore-github-oauth-*` | the GitHub OAuth App for UI sign-in, which lore-api runs (ADR-053) |
| `lore-api`, `lore-ui`, `lore-stations` | `ghcr-pull-secret` | `.dockerconfigjson` | `lore-ghcr-pull-secret` | a GitHub token with `read:packages` for the non-public images `ghcr.io/re-cinq/{lore-api,lore-mcp,lore-ui}` |

**Lore with the floor** (always, on a client install):

| Namespace | Secret | Keys | Source | What it is |
| --------- | ------ | ---- | ------ | ---------- |
| `lore-api`, `lore-stations` | `floor-service-token` | `token` | `lore-floor-service-token` | the floor's `serviceToken`; must equal the value in `floor-api` below |
| `lore-api` | `floor-git-credential-token` | `token` | `lore-floor-git-credential-token` | the token the floor presents when it asks lore-api for a git credential; must equal `gitCredentialToken` below |

**Floor** (namespace `lore-floor` on a client cluster, `floor` on our GKE; read by the floor chart, which creates none of them except an empty `agent-secrets`):

| Secret | Keys | What it is |
| ------ | ---- | ---------- |
| `floor-api` | `serviceToken`, `visitTokenSecret`, `gitCredentialToken` | `openssl rand -hex 32` each. `serviceToken` is what every client (Lore, the CLI) authenticates with |
| `floor-postgres` | `connectionString` | `postgres://user:password@host:5432/floor` |
| `agent-secrets` | `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`, optionally `GEMINI_API_KEY`; or, on Microsoft Foundry, `AGENT_PROVIDER` with an endpoint and a key per CLI (3.6); plus `lore-mcp-auth` = `Bearer <lore-ingest-token>` | the model credential every agent pod runs with, and the header the pod's Lore MCP server is called with. The cluster agent also writes per-visit tokens here |

**Optional:** `lore-stations/lore-reviewer-app` (a second GitHub App that approves pull requests for auto-merge), `lore-gemini-api-key`, and the OAuth + cookie secrets of Grafana, Headlamp and Utopia (cookie secrets are exactly 16, 24 or 32 bytes).

### 1.6 External accounts

| Account | Who creates it | What Lore needs |
| ------- | -------------- | --------------- |
| **GitHub App**, installed on the organization ([step by step](github-setup.md#1-the-github-app)) | the client's GitHub org owner | permissions: Contents read/write, Issues read/write, Pull requests read/write, Checks read, Metadata read, Webhooks (repository hooks) read/write. Subscribe to no events on the App itself: lore-api installs a hook per repository (`POST /api/repos/:o/:r/webhook/ensure`) for `pull_request`, `pull_request_review`, `pull_request_review_comment`, `issue_comment`, `issues`, `repository`, `push`, `release`, `create`, `check_suite` (`apps/lore-api/src/work/webhook/webhook-status.ts`). Values: App ID, installation ID, private key PEM, the App's slug |
| **GitHub OAuth App** for UI sign-in ([step by step](github-setup.md#2-the-oauth-app-for-sign-in)) | same | callback `https://<lore_api host>/api/auth/callback` (lore-api's, not the UI's); sign-in is restricted to members of `GITHUB_ORG` |
| lore-reviewer GitHub App (optional) | same | Pull requests read/write, Contents read, Checks read, Metadata read; no webhook. Lets the auto-merge loop approve the pull requests Lore's main App opened |
| **Slack app** (optional) | a Slack admin | from `scripts/slack-app-manifest.yaml`: bot scopes `chat:write`, `commands`, `users:read`, `users:read.email`, `reactions:read`; slash command `/lore` and events at `https://<lore_api_url>/api/webhook/slack` and `/slack-events` |
| **ghcr.io read token** ([step by step](github-setup.md#3-the-registry-token)) | the Lore team (re-cinq) | a `read:packages` token of a member of the re-cinq organization, for the non-public images `ghcr.io/re-cinq/{lore-api,lore-mcp,lore-ui,utopia}`. `lore-stations`, `lore-agent`, the floor and subsystem images (`ghcr.io/re-cinq/{floor,ai-agent-controller,ai-agent}`) and the third-party ones (`ghcr.io/cloudnative-pg/postgresql`, `dgraph/standalone`, `curlimages/curl`, `alpine`) are public |
| **Sign-in for Utopia** | the client | an OpenID Connect client (the chart's default issuer is Google, `https://accounts.google.com`) with the redirect URI `https://<utopia host>/api/v1/auth/oidc/callback`; the email domains allowed to sign in. Values: client ID, client secret |
| **Model access** | the client | agent pods: an Anthropic API key, or a Claude Code OAuth token (`claude setup-token`, bills a subscription), optionally a Gemini API key; which key an agent reads is per model family (`clusterAgent.modelSecretKeys`). Or **Microsoft Foundry** for Claude Code and Codex agents, see below. lore-api and stations: an Anthropic key (or Gemini, or an Ollama endpoint; one use can run on its own vendor through `LORE_<USE>_LLM_PROVIDER` and `LORE_<USE>_LLM_MODEL`) |
| **Embeddings** | see below | |

**Embeddings are Vertex AI only, today.** `LORE_EMBEDDING_PROVIDER` knows one vendor: Vertex `text-embedding-005`, 768 dimensions, reached through Google application-default credentials and a GCP project (`libs/shared/src/outbound/embeddings/select-embedding-provider.ts`). Without it Lore starts and runs, but every vector column stays empty and search falls back to keywords, which the evals put far below hybrid search. A client not on GCP has two options: a GCP project used for nothing but Vertex, with a service-account key mounted in lore-api (against this repo's no-long-lived-credentials rule, so a conscious exception), or a second `EmbeddingProvider` for the client's vendor at 768 dimensions (Azure OpenAI `text-embedding-3-small` fits), which is a code change tracked under [Known rough edges](#known-rough-edges).

**Agents on Microsoft Foundry.** Claude Code and Codex agents can run on Foundry. The client provides a Foundry deployment named exactly after each model id in the agent definitions, the two endpoints (`https://<resource>.openai.azure.com/openai/v1` for Codex, `https://<resource>.services.ai.azure.com/anthropic` for Claude Code), and an API key for each endpoint. Entra ID is not supported. The switch is a set of entries in the `agent-secrets` Secret (3.6), not a Helm value, and a cluster uses one provider. Lore's shipped agents name Claude and Gemini models, so on a Codex-only cluster each agent's model is changed on the `/agents` page after the install. Gemini agents do not go through Foundry.

**Lore's own model calls cannot use Foundry yet.** lore-api and stations make their own model calls (fact extraction, triage, context assembly, evals) through Anthropic, Gemini, Vertex or Ollama. There is no provider for an Azure or OpenAI-compatible endpoint. See [Known rough edges](#known-rough-edges).

### 1.6.1 GitHub Enterprise

| The client's GitHub | Works | What to set |
| ------------------- | ----- | ----------- |
| Enterprise Cloud on github.com | yes | nothing; it is github.com |
| Enterprise Server, self-hosted | yes | `GITHUB_HOST` (below) |
| Enterprise Cloud with data residency (`<name>.ghe.com`) | yes | `GITHUB_HOST: <name>.ghe.com` (below) |

Ask the client which one before the install: "GitHub Enterprise" names all three. Only the last two need `GITHUB_HOST`.

One install talks to one GitHub host. By default that is `github.com`; for a self-hosted GitHub Enterprise Server or an Enterprise Cloud tenant with data residency set `GITHUB_HOST` to its bare host name (no scheme, no path), for example `ghe.example.com` or `acme.ghe.com`, in the `env:` of `lore-api`, `lore-ui` and `lore-stations` (the commented examples in `deploy/install/values.azure.example.yaml`). Lore then calls the REST and GraphQL API at `https://<host>/api/v3` on a Server, or at `https://api.<host>` on a data residency host (any host ending in `.ghe.com`; the GraphQL address follows from the same base). Sign-in goes to `https://<host>/login/oauth/authorize` and git clones from `https://<host>/owner/name.git` for both kinds. Lore names a repository `<host>/owner/name` on the floor and links to `https://<host>`. Two hosts in one install are not supported, and stored data is not moved between hosts: a Server or data residency install is a fresh install. Lore has not been run against a real `ghe.com` tenant.

- Create the GitHub App and the OAuth App on the Server instance, as in [GitHub setup](github-setup.md), not on github.com.
- A Server must be GitHub Enterprise Server 3.11 or newer (this does not apply to data residency, which GitHub runs): Lore reads branch rules through `rules/branches` and sends `X-GitHub-Api-Version`. This is assumed from the documentation; no Server instance has run it yet.
- Agents and CI must reach the Server: allow it in `floor.agentNetworkPolicy.extraEgress` when it has a private address (commented example in `deploy/install/values.yaml`).
- The onboarded workflows use `actions/checkout@v4` and `actions/github-script@v7`: the instance needs GitHub Connect enabled, or those actions synced to it.
- The Actions runners must reach the Lore API URL (`LORE_API_URL`) to post test reports and ingest.
- The Server must reach the webhook hostname of 1.4 to deliver its events.

### 1.7 Who does what, by cloud

| Need | Client cluster (Azure, AKS) | Our GKE (re-cinq/infrastructure + Argo CD) |
| ---- | --------------------------- | ----------------------------------------- |
| cluster | infra team: AKS 1.27+, Azure CNI with network policy, node pools per 1.1, a ReadWriteOnce StorageClass (`managed-csi`), Workload Identity if ESO is used | GKE Autopilot, looked up by name; Dataplane V2 |
| ingress, TLS, DNS | infra team: ingress-nginx, cert-manager + ClusterIssuer, DNS records, public IP | `nginx-ingress`, `letsencrypt-prod`, external-dns |
| secrets | infra team: values handed over for the values file (3.3), or Azure Key Vault + ESO `ClusterSecretStore` | GCP Secret Manager + ESO + Workload Identity |
| Lore Postgres | infra team: Flexible Server with `vector`, or CNPG operator; Lore team: schema | CNPG `Cluster` in `lore-db`, backups to GCS |
| floor Postgres | infra team: a second database + role | same |
| Dgraph | infra team: a 50Gi volume class; Lore team: `platform.dgraph` in the values file (3.3) | `deploy/chart/templates/lore-dgraph.yaml` |
| model credentials | client: keys into the vault | GCP Secret Manager |
| embeddings | decision needed (1.6) | Vertex via `roles/aiplatform.user` on the lore-api service account |
| traces | nothing; lore-api disables the exporter when Cloud Trace is unavailable | Cloud Trace |
| cost pages | `/spend` shows the pod-hour estimate only | BigQuery `billing_export` (re-cinq/infrastructure) |
| deploys | the Lore team's laptops with namespace-scoped kubeconfigs, one `helm upgrade --install` (3.5) | build workflows bump image tags in the values file; Argo CD syncs every merge to `main` |

Where the Lore team creates the cluster too, every "infra team" row is ours. This guide has no commands for creating the AKS cluster, the Postgres server or the DNS zone. Section 2 covers the add-ons.

### 1.8 Operator's machine (Lore team)

kubectl, Helm 3.8+, `gh`, `psql`, and a kubeconfig scoped to the namespaces in 1.1. For the laptop install in section 6: git, Node.js 18+, Claude Code. `gcloud` only for our own GKE (section 4).

## 2. Cluster add-ons

Installed by the infra team with their tooling, or by the Lore team where allowed. Each is upstream's standard install:

```bash
# ingress-nginx (note the class name you choose; it is a value in sections 3 and 4)
helm upgrade --install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx -n ingress-nginx --create-namespace

# cert-manager + a ClusterIssuer named in section 4's values
helm upgrade --install cert-manager cert-manager --repo https://charts.jetstack.io \
  -n cert-manager --create-namespace --set crds.enabled=true

# CloudNativePG, only for an in-cluster Postgres (scripts/infra/setup-db.sh does this too)
helm upgrade --install cnpg cloudnative-pg --repo https://cloudnative-pg.github.io/charts \
  -n cnpg-system --create-namespace
# its barman-cloud plugin, for backups to object storage
curl -sL https://github.com/cloudnative-pg/plugin-barman-cloud/releases/download/v0.11.0/manifest.yaml \
  | sed 's/namespace: cnpg-system/namespace: <operator namespace>/' | kubectl apply -f -

# External Secrets Operator, only when secrets are mirrored from a vault
helm upgrade --install external-secrets external-secrets \
  --repo https://charts.external-secrets.io -n external-secrets --create-namespace
```

Then, only when secrets are mirrored from a vault, the `ClusterSecretStore` for it (ours is in re-cinq/infrastructure). The install in section 3 creates the namespaces itself.

## 3. Install on a client cluster

One Helm release installs Lore, the floor, the agent subsystem and Utopia. When you finish, the web UI answers on your hostname, and an issue opened on an onboarded repository starts an agent run.

The chart is `deploy/install` in this repo. It was rendered and linted with Helm 4.2.2 on 2026-11-16; see [Known rough edges](#known-rough-edges) for what it does not do.

| Step | What you do |
| ---- | ----------- |
| 3.1 | Check the cluster is ready |
| 3.2 | Get the chart |
| 3.3 | Fill in the values file |
| 3.4 | Apply the database schema |
| 3.5 | Install |
| 3.6 | Give the agents their model key |
| 3.7 | Verify |

### 3.1 Check the cluster is ready

The infra team provides everything in section 1. The cluster should have this much reserved for Lore ([1.1.1](#111-resources-to-reserve) explains the numbers and how to size for more agents):

| What | Recommended, for up to 5 agents at once |
| ---- | --------------------------------------- |
| Platform nodes | 3 × 8 vCPU / 32 GiB |
| Agent nodes | 2 × 8 vCPU / 32 GiB, autoscaling, 128 GiB OS disk |
| Postgres | 2 vCores, 8 GiB, 50 GiB storage |
| Volumes | ReadWriteOnce: 50 GiB (Dgraph), 80 GiB and 20 GiB (Utopia) |

Check what the cluster has:

```bash
kubectl get nodes -o custom-columns=NAME:.metadata.name,CPU:.status.allocatable.cpu,MEMORY:.status.allocatable.memory
kubectl get storageclass
```

Then confirm the parts the install depends on:

```bash
kubectl get ingressclass          # the class name goes into the values file
kubectl get clusterissuer         # so does the issuer name
kubectl get crd clusters.postgresql.cnpg.io           # the CloudNativePG operator, for Utopia's database
kubectl auth can-i create customresourcedefinitions   # must answer: yes
```

Postgres needs two databases on a PostgreSQL 16 server, `lore` and `floor`, each with its own role. `lore` is empty and owned by its role, and the `vector` extension is available in it:

```bash
psql "host=<postgres host> dbname=lore user=lore sslmode=require" \
  -c "select name from pg_available_extensions where name = 'vector'"
```

It prints one row, `vector`. No row means the extension is not allow-listed on the server (Azure: the `azure.extensions` server parameter). A server admin can also create it now, so the install does not depend on the privileges of `lore` (3.4):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

DNS: the five hostnames of 1.4 (API, UI, MCP, webhook, Utopia) point at the ingress controller's public IP.

You also need these in hand. **[GitHub setup](github-setup.md) walks through the first three**; section 1.6 covers the rest:

| What | Used for |
| ---- | -------- |
| GitHub App: App ID, installation ID, private key, slug | Lore acting on repositories |
| GitHub OAuth App: client ID and secret | signing in to the UI |
| A GitHub user and token with `read:packages`, from re:cinq | pulling the non-public images |
| An OpenID Connect client for Utopia: client ID and secret | signing in to Utopia |
| An Anthropic API key | Lore's own jobs, and the agents |
| On Microsoft Foundry, in its place: the endpoints and keys of 1.6 | the agents |

### 3.2 Get the chart

```bash
git clone https://github.com/re-cinq/lore.git
git clone https://github.com/re-cinq/utopia.git
cd lore
helm dependency update deploy/install
```

The two checkouts must sit side by side: Utopia's chart is read from `../utopia`. The last command prints `Pulled: ghcr.io/re-cinq/charts/floor:0.5.4`; the floor chart is public and needs no login.

### 3.3 Fill in the values file

```bash
cp deploy/install/values.azure.example.yaml my-values.yaml
```

`my-values.yaml` will hold secrets. Keep it out of git.

Replace every `CHANGE-ME` and every `example.com`:

| In the file | Put |
| ----------- | --- |
| `secrets.ghcr.username`, `.token` | the GitHub user and `read:packages` token from re:cinq |
| `secrets.loreDbPassword` | the password of the `lore` Postgres role |
| `secrets.floorDbConnectionString` | `postgres://floor:<password>@<postgres host>:5432/floor` |
| `secrets.ingestToken`, `.internalToken`, `.webhookSecret`, `secrets.floor.*` | six random values, generated below |
| `secrets.githubApp.*` | the GitHub App's ID, private key (the whole PEM) and installation ID |
| `secrets.githubOAuth.*` | the OAuth App's client ID and secret |
| `secrets.anthropicApiKey` | the Anthropic key for Lore's own jobs. With no Anthropic key (a Foundry-only client), delete the line |
| `secrets.utopia.dbPassword`, `.appDbPassword`, `.secretKey`, `.cookieSecret` | four more random values, generated below |
| `secrets.utopia.oauthClientId`, `.oauthClientSecret` | Utopia's OpenID Connect client |
| `utopia.hostname`, `UTOPIA_URL` | the Utopia hostname |
| `utopia.oidc.allowedDomains` | the email domain allowed to sign in to Utopia, for example `acme.com` |
| `utopia.ingress.className`, `.clusterIssuer`, `utopia.data.storageClass` | the same names as for Lore |
| `lore-platform.platform.ingressClassName`, `.clusterIssuer` | the names from 3.1 |
| `lore-platform.platform.dgraph.storageClass` | a ReadWriteOnce storage class (`managed-csi` on AKS) |
| every `host:` under `lore-platform.platform.ingresses` | your four hostnames. `lore-ui` and `lore-ui-live` take the same one, the UI's |
| `LORE_DB_HOST`, in three places | the Postgres host |
| `LORE_API_URL`, `LORE_UI_URL`, `LORE_WEBHOOK_URL`, `LORE_API_PUBLIC_URL` | the same hostnames as the ingresses |
| `LORE_WS_URL` | `wss://<ui host>/api/ws`. The UI's host, not the API's: the browser's live socket carries the sign-in cookie, and the `lore-ui-live` ingress sends that one path to lore-api |
| `GITHUB_ORG` | the GitHub organization; its members may sign in |
| `GITHUB_APP_SLUG` | the GitHub App's slug |

Generate the random values:

```bash
for name in ingestToken internalToken webhookSecret serviceToken visitTokenSecret gitCredentialToken \
            utopia.dbPassword utopia.appDbPassword utopia.secretKey; do
  echo "$name: $(openssl rand -hex 32)"
done
echo "utopia.cookieSecret: $(openssl rand -hex 16)"   # exactly 32 characters
```

You write each value once. The chart puts it into every Secret that needs it, in every namespace.

Keep `secrets.ingestToken` at hand: step 3.6 and every developer laptop use it.

Check the file before touching the cluster:

```bash
grep -c -e CHANGE-ME -e example.com my-values.yaml      # must print 0
helm template lore deploy/install -n lore-floor -f my-values.yaml > /dev/null && echo ok
```

A missing value stops the second command and names it, for example `secrets.ghcr.username is required`.

Settings you may need:

| Situation | Add to `my-values.yaml` |
| --------- | ----------------------- |
| The cluster runs no NodeLocal DNSCache (the default on AKS) | `floor.agentNetworkPolicy.nodeLocalDnsAddress: ""` |
| GitHub Enterprise Server | uncomment `GITHUB_HOST` in the three `env:` blocks and set the Server's bare host name (see [1.6.1](#161-github-enterprise)) |
| Utopia sign-in through Microsoft Entra ID | `utopia.oidc.issuer: https://login.microsoftonline.com/<tenant id>/v2.0` |
| Agents run on Microsoft Foundry | nothing here; the entries go into `agent-secrets` (3.6) |
| Agents run on a Claude Code OAuth token, not an API key | `floor.clusterAgent.modelSecretKeys: claude=CLAUDE_CODE_OAUTH_TOKEN` |
| Secrets come from a vault through External Secrets | `secrets.create: false`, and provide every Secret of 1.5 yourself |
| A Slack app | `secrets.slack.signingSecret` and `secrets.slack.botToken` |
| No Utopia | `utopia.enabled: false` and `lore-platform.lore-api.utopia.enabled: false`, both |

Any other value of the charts can be set under `lore-platform:`, `floor:` and `utopia:`. `deploy/install/values.yaml` lists what the chart already sets and why.

### 3.4 The database schema

Nothing to run by hand. The install applies the schema itself.

The migrations hook (a Job that runs before every install and upgrade, as the role `lore`) checks the database first. On an empty one it applies the baseline schema from `deploy/chart/charts/ui-helm/baseline/*.sql` in name order, records it in `lore.schema_migrations` as version `0000_baseline`, then applies the incremental migrations. A database that already has the baseline is left alone. The hook needs no superuser, only the role that owns the database.

The baseline creates one team schema, `org_shared`, which every repository uses until a team gets its own (value `migrations.teamSchemas`, a comma separated list, only read on the first install).

**If `lore` cannot create the extension.** The first baseline file runs `CREATE EXTENSION IF NOT EXISTS vector;`. Where the server refuses it, the Job stops and its log prints the statement an admin runs once, in database `lore`:

```bash
kubectl -n lore-ui logs job/lore-ui-migrate
```

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

On Azure the extension must also be allow-listed in `azure.extensions`. After that, run `helm upgrade --install` again with the same command as 3.5: the hook continues from where it stopped, because each baseline file is recorded as it completes.

Our own CloudNativePG database is the exception: `scripts/infra/setup-db.sh` creates the cluster, the extension and the schemas, and the hook then finds the baseline present. The scripts `scripts/infra/setup-*-schema.sh` apply the same SQL files by `kubectl exec` and stay for that path.

### 3.5 Install

The release name and namespace are fixed. The chart refuses any other.

```bash
helm upgrade --install lore deploy/install \
  -n lore-floor --create-namespace -f my-values.yaml
```

Helm creates the namespaces and Secrets, runs the floor's database migrations and Lore's (the baseline schema first, on an empty database, see 3.4), then starts everything. When it returns:

```bash
for ns in lore-floor lore-api lore-ui lore-stations lore-dgraph; do
  echo "== $ns"; kubectl get deployments,statefulsets -n "$ns"
done
```

| Namespace | Ready when you see |
| --------- | ------------------ |
| `lore-floor` | `lore-floor-api` 2/2, `lore-floor-cluster-agent` 1/1, `agent-controller` 1/1, `utopia` 1/1, and the pod `utopia-db-1` Running |
| `lore-api` | `lore-api` 1/1, `lore-mcp-gateway` 1/1 |
| `lore-ui` | `lore-ui` 1/1 |
| `lore-stations` | `lore-stations` 1/1 |
| `lore-dgraph` | `lore-dgraph-alpha` 1/1 |

If a pod stays in `ImagePullBackOff`, the pull token is wrong or lacks `read:packages`: `kubectl -n lore-api describe pod -l app=lore-api` shows the registry's answer. Fix `secrets.ghcr` and run the install command again.

### 3.6 Give the agents their model key

Agent pods read their credentials from the `agent-secrets` Secret, which the floor created empty. Fill it once; the floor keeps it across upgrades.

```bash
kubectl -n lore-floor patch secret agent-secrets --type merge -p '{"stringData":{
  "ANTHROPIC_API_KEY":"sk-ant-...",
  "lore-mcp-auth":"Bearer <the secrets.ingestToken value>"}}'
```

With a Claude Code OAuth token, the key is `CLAUDE_CODE_OAUTH_TOKEN` (and the setting from the table in 3.3). A Gemini key goes under `GEMINI_API_KEY`.

**On Microsoft Foundry**, set the provider and the endpoint and key instead of the Anthropic key:

```bash
kubectl -n lore-floor patch secret agent-secrets --type merge -p '{"stringData":{
  "AGENT_PROVIDER":"foundry",
  "AZURE_OPENAI_BASE_URL":"https://<resource>.openai.azure.com/openai/v1",
  "AZURE_OPENAI_API_KEY":"<key>",
  "lore-mcp-auth":"Bearer <the secrets.ingestToken value>"}}'
```

The two `AZURE_OPENAI_*` entries are for Codex. Claude Code takes the `ANTHROPIC_FOUNDRY_BASE_URL` (ends in `.services.ai.azure.com/anthropic`) and `ANTHROPIC_FOUNDRY_API_KEY` pair. A cluster that runs one CLI adds only its pair. Changes reach new runs only. A 404 from the endpoint means there is no deployment named after the agent's model id. For limits and troubleshooting, see the [subsystem guide](https://re-cinq.github.io/ai-agent-subsystem/tasks/run-on-foundry/).

### 3.7 Verify

```bash
curl -s https://<api host>/healthz

kubectl get crd agents.agents.re-cinq.com stations.agents.re-cinq.com agentdefinitions.agents.re-cinq.com
kubectl -n lore-floor exec deploy/lore-floor-api -- wget -qO- http://localhost:8080/healthz

# Lore sees the floor: the run list reads from it
curl -s -H "Authorization: Bearer <secrets.ingestToken>" https://<api host>/api/floor-runs | head -c 300
```

Then end to end: sign in at `https://<ui host>`, onboard a repository (section 7), and open an issue on it with the label `priority:medium`. The implementation loop picks it up and a run appears at `/assembly-runs`.

### 3.8 Upgrade

```bash
git pull
git -C ../utopia pull
helm dependency update deploy/install
helm upgrade --install lore deploy/install -n lore-floor -f my-values.yaml
```

The image tags are pinned in `deploy/install/values.yaml`, so an upgrade moves to the builds that file names. All images come from `ghcr.io/re-cinq`:

| Image | Public | Tag set in |
| ----- | ------ | ---------- |
| `lore-api`, `lore-mcp`, `lore-ui` | no, pulled with `ghcr-pull-secret` | `lore-platform.<app>.image.tag` |
| `lore-stations` | yes | `lore-platform.lore-stations.image.tag` |
| `lore-agent` (what agent pods work in) | yes | `lore-platform.lore-api.floor.agentImage` |
| `floor` | yes | `floor.version` |
| `ai-agent-controller`, `ai-agent` | yes | `floor.subsystem.version` |
| `utopia` | no, pulled with `ghcr-pull-secret` | `utopia.image.tag` and `.digest` |

## 4. Our own GKE, with Argo CD

Our reference install, described in [deploy/README.md](../deploy/README.md). Argo CD on `internal-cluster` (project `re-cinq-internal`) deploys `deploy/chart` with `deploy/clusters/internal-cluster.values.yaml` on every merge to `main` (re-cinq/infrastructure, `docs/deploying.md`); nobody runs `helm` against that cluster. The chart renders the namespaces, the ExternalSecrets, the ingresses, the CloudNativePG cluster, Dgraph and the five services. Google Cloud resources (service accounts, buckets, Secret Manager containers, the BigQuery billing export) and the cluster add-ons (ESO and `ClusterSecretStore/gcp-secret-manager`, CNPG operator, cert-manager, ingress) are in re-cinq/infrastructure.

There the floor and the agent subsystem are separate Argo CD applications, in the namespaces `floor` and `ai-agents`, installed as [floor/docs/install.md](https://github.com/re-cinq/floor/blob/main/docs/install.md) describes. The `deploy/install` chart is not used.

Secret values are added by a person with `gcloud secrets versions add <name> --project re-cinq-internal` ([managing-secrets.md](managing-secrets.md)). Non-secret config is an edit to the values file. On a fresh cluster, `scripts/infra/setup-db.sh` creates the CloudNativePG cluster with the `vector` extension; the migrations hook applies the baseline schema on the first sync (3.4).

## 5. Configure webhooks

Webhooks are normally managed for you: lore-api's `POST /api/repos/:owner/:repo/webhook/ensure` creates or re-points a repository's hook at `LORE_WEBHOOK_URL`, and onboarding calls it. By hand, only when the App lacks the permission:

```bash
gh api repos/OWNER/REPO/hooks --method POST --input - <<EOF2
{
  "name": "web",
  "active": true,
  "events": ["issues", "pull_request", "pull_request_review", "pull_request_review_comment",
             "issue_comment", "repository", "push", "release", "create", "check_suite"],
  "config": {
    "url": "https://lore-events.example.com/api/events",
    "content_type": "json",
    "secret": "YOUR_WEBHOOK_SECRET"
  }
}
EOF2
```

The hook URL is `https://<lore_event_router_hostname>/api/events`; the ingress rewrites it onto lore-api's `POST /api/webhook/github`, which verifies the HMAC in `X-Hub-Signature-256` over the raw body, so `secret` must equal `lore-webhook-secret` or every delivery is refused. Installs that still point at `/api/webhook/github` on `lore_webhook_hostname` reach the same route.

## 6. Install on a developer laptop

This is the per-developer install: it builds and registers the Lore MCP server locally so Claude Code gets org context in every onboarded repo. No cluster access needed; the local server proxies to the backend deployed above.

**Runs on macOS and Linux** (the installer is `#!/usr/bin/env bash` and stays within bash 3.2, the macOS default).

**Prerequisites:**

- git
- Node.js >= 18 and npm (`uuidgen` or `python3` for the agent ID; one is present on both OSes)
- [Claude Code](https://claude.com/claude-code) (`claude` CLI); the installer registers the MCP server through it
- A reachable Lore backend URL (the API host from 1.4). The local server has no offline mode; context, memory and pipeline calls all proxy to it.

**Install:**

```bash
git clone https://github.com/re-cinq/lore.git
cd lore && scripts/install.sh
```

`scripts/install.sh` is idempotent, safe to re-run after a `git pull`. It:

- clones/updates the context checkout into `~/.re-cinq/lore`
- runs `npm ci` once at the repo root (npm workspaces) and builds `@re-cinq/lore-shared` + `@re-cinq/lore-mcp`
- registers the `lore-context` MCP server with Claude Code, pointing at `~/.re-cinq/lore/apps/mcp-server/dist/index.js`
- installs the platform skills, hooks and system prompt
- generates a stable agent ID at `~/.lore/agent-id`
- runs `scripts/lore-doctor.sh` to verify the install

**Point it at your backend.** The installer reads these from global git config; set them before (or after) running it:

```bash
git config --global lore.api-url     "https://lore-api.example.com"
git config --global lore.ingest-token "<your-token>"   # optional; needed to delegate tasks
```

**Where to get these values.** They belong to your team's deployed Lore instance, not something you generate locally:

- **`lore.api-url`**: the external API URL. Find it on the Lore web UI settings page, or ask the platform team.
- **`lore.ingest-token`**: the shared API token. Grab it from the same web UI settings page (it has a "Regenerate Token" button), or ask the platform team. With cluster access: `kubectl get secret lore-ingest-token -n lore-api -o jsonpath='{.data.token}' | base64 -d`.

If you run the **whole stack locally** instead, these are set for you (`http://localhost:3001` and a fixed dev token), so you can skip this step. The token is also prompted for interactively on first install. Re-run `scripts/install.sh` (or `scripts/lore-doctor.sh`) to confirm everything is green.

> **Want the whole stack on your laptop instead?** `npm start` from the repo root brings up Docker Postgres + Dgraph and runs the web UI, API, stations and MCP server locally with live reload, no remote backend needed. Or set `LORE_API_URL` to a deployed lore-api in `.env.local` and `npm start` runs only the web UI against it. To sign into the web UI you create a one-time GitHub OAuth app; full steps in [Run the full stack locally](building-lore/contributing.md#run-the-full-stack-locally).

## 7. Onboard repos

**Via UI:** `https://<lore_ui_hostname>/onboard`

**Via CLI:** `claude "onboard your-org/your-repo to lore"`

## Verify

A client cluster: section 3.7. Our GKE, where the floor is in `floor`:

```bash
for ns in lore-api lore-ui lore-db lore-stations lore-dgraph; do
  echo "== $ns"; kubectl get deployments,statefulsets -n "$ns"
done
curl -s https://<lore_api host>/healthz

kubectl -n floor get pods
kubectl get crd agents.agents.re-cinq.com stations.agents.re-cinq.com agentdefinitions.agents.re-cinq.com
kubectl -n floor exec deploy/floor-api -- wget -qO- http://localhost:8080/healthz

curl -s -H "Authorization: Bearer <lore-ingest-token>" https://<lore_api host>/api/floor-runs | head -c 300
```

## Upgrading

A client cluster: section 3.8. Our GKE: merge to `main`; the build workflows bump the image tags in `deploy/clusters/internal-cluster.values.yaml` and Argo CD syncs ([deploy/README.md](../deploy/README.md)).

## Disaster recovery

Our GKE: the cluster's add-ons and cloud resources come back from re-cinq/infrastructure and Argo CD re-syncs the chart. The Secret Manager containers keep their versions, so a rebuilt platform re-attaches to them with no re-seeding. Everything else is in the two Postgres databases and Dgraph: back those up.

## Known rough edges

What an install on a client cluster hits. The list stays until each fix lands.

1. **The `deploy/install` chart has been rendered, not yet installed on a cluster** (2026-11-16). The order in which it creates namespaces and Secrets ahead of the migration jobs is by design and unproven.
2. **The baseline install has never run on a real Azure server** ([#3904](https://github.com/re-cinq/lore/issues/3904), see 3.4). CI runs it against an empty pgvector database owned by a role without superuser, and the extension was the only step that needed more: a server admin creates it. Whether Azure Flexible Server lets `lore` create `vector` after allow-listing is not verified.
3. **Embeddings are Vertex only** ([#3903](https://github.com/re-cinq/lore/issues/3903), see 1.6). Off Google Cloud, search is keyword-only. A second `EmbeddingProvider` at 768 dimensions is the fix.
4. **The agents' model key is a manual step** (3.6): the floor chart creates `agent-secrets` empty and takes no value for it.
5. **Image tags in `deploy/install/values.yaml` are updated by hand.** The build workflows bump only our own cluster's values file.
6. **Utopia's chart is not published.** The install reads it from a checkout of re-cinq/utopia beside this repo (3.2), at whatever commit that checkout is on.
7. **Utopia after install.** Sign-in was only ever run against Google as the issuer; Microsoft Entra ID as the issuer (3.3) is untested. The write token that lets Lore create a knowledge base per repository is made by hand once Utopia is up ([managing-secrets.md](managing-secrets.md#the-utopia-write-token-lore-utopia-lore-api-token)); until then a person sets each repository up in Utopia.
8. **Shared settings are repeated.** `LORE_DB_HOST` and the public URLs are written once per app in the values file.
9. lore-api's Cloud Trace exporter has no `roles/cloudtrace.agent` grant on our GKE, so traces are silently off there ([#3905](https://github.com/re-cinq/lore/issues/3905)).
10. **Lore's own model calls cannot use Microsoft Foundry.** A provider for an OpenAI-compatible endpoint is the fix.
11. **Foundry, GitHub Enterprise Server and GitHub Enterprise Cloud with data residency have not run on a client cluster.** No agent pod has cloned from a Server or a `ghe.com` tenant and no Codex agent of Lore's has run on Foundry. The shipped agents name Claude and Gemini models.
12. **Grafana and Prometheus are not in the chart** (1.2).
13. **No Microsoft Teams integration.** The digest and notifications post to Slack only.

## Running on ARM64

Lore, the ai-agent-subsystem and the floor run natively on ARM64 machines (Apple Silicon, Graviton, Ampere) without emulation. Docker picks the right architecture automatically with no `--platform` flag needed.

- **Lore images**: `lore-api`, `lore-mcp`, `lore-stations`, `lore-ui` and `lore-agent` are multi-arch.
- **ai-agent-subsystem**: its `images.yml` builds `linux/amd64` and `linux/arm64`.
- **floor**: both its release tags (`publish.yml`) and dev images (`build.yml`) are multi-arch.

Local dev on Apple Silicon is fully supported; the Dgraph compose service runs natively.

To verify a specific image's supported platforms:

```bash
docker buildx imagetools inspect <image>
```

If multi-arch, the output lists `linux/arm64` among its platforms.

> **Note**: our GKE cluster stays on amd64 nodes. This section is for people running the stack on ARM machines of their own.
