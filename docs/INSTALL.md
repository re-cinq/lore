# Installing Lore

Lore is three installs on one Kubernetes cluster, in this order:

| Order | What | Where it comes from | Namespace | Who does it on a client cluster |
| ----- | ---- | ------------------- | --------- | ------------------------------- |
| A | Cluster add-ons: ingress controller, cert-manager, DNS, Postgres (operator or managed), secret store | the client's own tooling | theirs | the infra team |
| B | The **floor**, the engine that runs agent pods. Its Helm chart carries the **ai-agent-subsystem** (CRDs + controller) that turns a run into a pod | [re-cinq/floor](https://github.com/re-cinq/floor), chart `oci://ghcr.io/re-cinq/charts/floor` | `floor` | the Lore team, with Helm |
| C | **Lore** itself: API, web UI, stations, MCP gateway, database hooks. One umbrella Helm chart | this repo, `infra/terraform/modules/gke-mcp/lore-platform` | `lore-api`, `lore-ui`, `lore-stations`, `lore-db`, release record in `lore-floor` | the Lore team, with Helm (on our own GKE: terraform) |

Section 1 is the checklist for the team that provisions the cluster. Sections 2 to 4 are the installs. The developer-laptop install, onboarding and verification follow. The ai-agent-subsystem is not installed on its own: the floor chart vendors it (`subsystem.enabled=true`). Install it separately, from [its own docs](https://re-cinq.github.io/ai-agent-subsystem/), only when another floor on the same cluster already runs it; the floor is then installed with `--skip-crds`.

## 1. Prerequisites

Everything below must exist before the Lore team runs a single `helm install`. Each item says who provides it: the **infra team** (cluster, cloud, networking, databases) or the **Lore team** (everything applied with Helm or kubectl inside the Lore and floor namespaces). The right-hand notes say how our own GKE reference install provides it; on another cloud the infra team substitutes.

### 1.1 Cluster

| Need | Value | Why |
| ---- | ----- | --- |
| Kubernetes | 1.27 or newer | the ai-agent-subsystem chart's minimum |
| Helm | 3.8 or newer | the floor and subsystem charts are OCI charts |
| Node architecture | amd64 or arm64 | every image is multi-arch (see [Running on ARM64](#running-on-arm64)) |
| Network plugin | one that **enforces NetworkPolicy** (GKE Dataplane V2, Azure CNI with Azure NPM, Calico, Cilium) | agent pods run code a model wrote a minute ago; their egress policy is the only wall. On a plugin that does not enforce, the policy is accepted and binds nothing |
| Pod Security | `baseline` is enough on the `floor` namespace | the run pod's init container runs as root to set up the workspace; floor's own pods run as uid 1000, read-only root filesystem |
| Cluster-admin, once | to install the CRDs: ai-agent-subsystem (`agents`, `agentdefinitions`, `stations`.agents.re-cinq.com), CloudNativePG, External Secrets, cert-manager, prometheus-operator | CRDs are cluster-scoped |
| Namespace admin for the Lore team | `floor`, `lore-api`, `lore-ui`, `lore-stations`, `lore-db`, `lore-floor` (+ `lore-dgraph`) | all of our Helm releases and kubectl applies stay inside these |
| NodeLocal DNSCache | tell us its address if the cluster runs one (GKE: `169.254.20.10`) | it answers on a link-local address the agent-pod egress policy must open explicitly, or pods resolve nothing |

**Capacity.** Requests and limits as shipped. Add agent pods on top: one pod per running agent, sized by its agent definition (Lore's own run at 2 Gi to 4 Gi memory each); N concurrent runs is N times that.

| Workload | Replicas | CPU request / limit | Memory request / limit | Disk |
| -------- | -------- | ------------------- | ---------------------- | ---- |
| lore-api | 1 | 100m / 2 | 256Mi / 1Gi | |
| lore-mcp-gateway | 1 | 100m / 500m | 256Mi / 512Mi | |
| lore-ui (+ a migrate Job per deploy) | 1 | 100m / 500m | 256Mi / 512Mi | |
| lore-stations (+ 5 small CronJobs) | 1 | 50m / 500m | 256Mi / 512Mi | |
| lore-db, Postgres 16 + pgvector (if run in-cluster with CloudNativePG) | 1 | 500m / 2 | 1Gi / 4Gi | 50Gi |
| Dgraph standalone v24 | 1 | 1 / 4 | 4Gi / 16Gi | 50Gi |
| floor api | 2 | small | small | |
| floor cluster agent + subsystem controller | 1 + 1 | 50m / 250m each | 128Mi / 1Gi | |
| agent pods | N | per agent definition | 2Gi to 4Gi each | ephemeral storage per definition |
| optional: Prometheus + Grafana | | 250m+100m / 2Gi+1Gi | | 10Gi |

Where this comes from: `infra/terraform/modules/gke-mcp/lore-platform/charts/*/values.yaml`, `infra/terraform/lore-db.tf`, `infra/terraform/lore-dgraph.tf`, the floor chart's `values.yaml`.

### 1.2 Cluster add-ons (infra team)

These are **assumed, not installed**, by Lore's own terraform; our GKE cluster already had them. The infra team installs them, or agrees that the Lore team may.

| Add-on | What Lore needs from it | Our GKE value |
| ------ | ----------------------- | ------------- |
| Ingress controller | ingress-nginx. The Lore ingresses use nginx annotations (`rewrite-target`, `proxy-body-size`, WebSocket read/send timeouts of 3600 s). The IngressClass name is a value we set | class `nginx-ingress` |
| cert-manager | a `ClusterIssuer` that issues public certificates for the hostnames in 1.4 | `letsencrypt-prod` |
| DNS | A records for the hostnames in 1.4, pointing at the ingress controller's public IP. external-dns reading the `external-dns.alpha.kubernetes.io/hostname` annotation, or records made by hand | external-dns |
| Postgres | see 1.3. In-cluster: the **CloudNativePG operator** (`clusters.postgresql.cnpg.io`), and for backups to object storage its barman-cloud plugin | CNPG operator in a shared namespace (`cnpg_operator_namespace`), plugin v0.11.0 installed by hand (`infra/terraform/lore-db.tf` header) |
| Secret store | optional. External Secrets Operator with a `ClusterSecretStore` on the client's vault, or the infra team hands the Lore team the values and we create plain Secrets (1.5) | ESO 0.12.1 + GCP Secret Manager (`infra/terraform/eso.tf`) |
| Metrics | optional. kube-prometheus-stack; every Lore service and the floor serve Prometheus text on a `metrics` port (:9464) | `enable_monitoring` ([ADR-050](../adrs/ADR-050-prometheus-grafana-metrics.md)) |

### 1.3 Databases and disks (infra team)

| Need | Spec | Notes |
| ---- | ---- | ----- |
| **Lore Postgres** | PostgreSQL 16, extension `vector` (pgvector 0.5 or newer, for HNSW indexes), database `lore`, role `lore` as its owner, reachable from the Lore namespaces | in-cluster: a CloudNativePG `Cluster`, 1 instance, 50Gi, image `ghcr.io/cloudnative-pg/postgresql:16-bookworm` (what `scripts/infra/setup-db.sh` creates). Managed: Azure Database for PostgreSQL Flexible Server with `vector` allow-listed in `azure.extensions`, or RDS/Cloud SQL with pgvector. Lore's schema is applied by `scripts/infra/setup-*.sh` once and by a migrations hook on every deploy (`infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/`) |
| **floor Postgres** | a **second database and role**, never shared with Lore: floor owns its schema (tables `events`, `blobs`, `definitions`) and migrates it on every install. Any Postgres; the role may create tables | the same server is fine. The floor chart never deploys one ([floor install doc](https://github.com/re-cinq/floor/blob/main/docs/install.md)) |
| **Dgraph** | one StatefulSet, `dgraph/standalone:v24.0.0`, 50Gi ReadWriteOnce volume, 4Gi to 16Gi memory | the spec-traceability and memory graphs. Only a manifest, no chart: see 4.1 |
| Backups | in-cluster Postgres: an object-storage bucket for barman (GCS, S3 or Azure Blob) with write access from the `lore-db` namespace; managed Postgres: its own backups | ours: GCS bucket, 30-day lifecycle, daily `ScheduledBackup` at 02:00 |
| StorageClass | any ReadWriteOnce class for the two 50Gi volumes (and 10Gi for Prometheus) | ours: `standard-rwo` (pd-balanced) |

Not needed off GCP: the task-log bucket and its KMS key (`infra/terraform/logs.tf`). Only the laptop task runner writes it; leave `LORE_LOG_BUCKET` unset.

### 1.4 Network, DNS and TLS (infra team)

Public hostnames, one certificate each:

| Hostname (our variable) | Serves | Who must reach it from outside |
| ----------------------- | ------ | ------------------------------ |
| `lore_api_url` | the Lore REST API and the browser's live WebSocket at `/api/ws` | developer laptops (the local MCP server proxies everything here), CI (`lore-code-trace`, spec ingest), Slack, browsers |
| `lore_ui_hostname` | the web UI | browsers |
| `lore_event_router_hostname` | the **canonical GitHub webhook URL**, `https://<host>/api/events`, rewritten by the ingress onto lore-api's `POST /api/webhook/github` ([ADR-044](../adrs/ADR-044-event-router-owns-the-event-bus.md)) | GitHub |
| `lore_mcp_url` | the MCP gateway for agents outside the cluster | optional. Agent pods in the cluster use the in-cluster Service instead (below) |
| `lore_webhook_hostname` | legacy alias of the webhook URL | only for repositories onboarded before ADR-044; a new install leaves it empty |
| floor | none by default; the floor API is a ClusterIP Service | only if a second cluster joins the floor |

In-cluster paths that NetworkPolicies must allow:

| From | To | Port |
| ---- | -- | ---- |
| agent pods (label `agents.re-cinq.com/component: job`, namespace `floor`) | cluster DNS, and NodeLocal DNSCache if present | 53 |
| agent pods | the public internet (github.com, api.anthropic.com, generativelanguage.googleapis.com, npm, ghcr.io), private ranges and the cloud metadata address excluded | 443 |
| agent pods | floor api pods, same namespace | 8080 |
| agent pods | `lore-mcp-gateway` in `lore-api` (the MCP server and the skills registry the pod fetches at start) | 8080 |
| lore-api, lore-stations | floor api (`http://floor-api.floor.svc.cluster.local:8080`) | 8080 |
| lore-ui, lore-stations, lore-mcp-gateway | lore-api (`http://lore-api.lore-api.svc.cluster.local:3000`) | 3000 |
| lore-api, lore-ui, lore-stations | Postgres; lore-api also Dgraph (`:8080`) | 5432, 8080 |

The floor chart renders the first three rows; the fourth is its `agentNetworkPolicy.extraEgress` (section 3). Nothing may reach an agent pod. Agent pods do not use the public MCP hostname: on a plugin that short-circuits a public VIP back into the cluster, the post-NAT private address is dropped by the policy's private-range exclusion, so the pod hangs (`infra/terraform/lore-platform.tf`). Whatever stands between lore-api and the floor API must pass WebSocket upgrades and not close a connection idle for under 30 s (the floor pings every 25).

### 1.5 Secrets

Who generates what: the infra team or the client's security team holds the vault; the Lore team needs the values in Kubernetes Secrets with exactly these names and keys, in these namespaces. Either ESO mirrors them from the vault (our GKE: `infra/terraform/external-secrets.tf`, one `ExternalSecret` per row) or we create them with `kubectl create secret`. Generation hints and the rotation procedure: [managing-secrets.md](managing-secrets.md).

**Lore, required.** The source column is the name in our GCP Secret Manager, which `scripts/infra/seed-secrets.sh` prompts for.

| Namespace | Secret | Keys | Source | What it is |
| --------- | ------ | ---- | ------ | ---------- |
| `lore-api` | `lore-api-db-password` | `password` | `lore-db-password` | the `lore` Postgres role's password |
| `lore-ui` | `lore-db-password` | `password` | same | |
| `lore-stations` | `lore-stations-db-password` | `password` | same | |
| `lore-api`, `lore-ui`, `lore-stations` | `lore-ingest-token` | `token` | `lore-ingest-token` | the shared API bearer token (`openssl rand -hex 32`). Laptops and CI use it too |
| `lore-api`, `lore-stations` | `lore-agent-internal-token` | `token` | `lore-agent-internal-token` | the token stations present to lore-api |
| `lore-api`, `lore-ui` | `github-app-credentials` | `app-id`, `private-key`, `installation-id` | `lore-github-app-*` | the GitHub App (1.6) |
| `lore-stations` | `lore-stations-github-app` | same three | same | |
| `lore-api` | `lore-webhook-secret` | `secret` | `lore-webhook-secret` | HMAC secret of the GitHub webhooks |
| `lore-api` | `lore-anthropic-key` | `anthropic-api-key` (+ `anthropic-admin-key`, optional, cost sync) | `lore-anthropic-api-key` | the model key lore-api's own jobs use (fact extraction, triage, evals) |
| `lore-stations` | `lore-stations-anthropic-key` | same | same | |
| `lore-api` | `lore-slack-credentials` | `signing-secret`, `bot-token` | `lore-slack-*` | the Slack app (1.6). Optional: the charts tolerate its absence |
| `lore-stations` | `lore-stations-slack` | `bot-token` | `lore-slack-bot-token` | |
| `lore-api` | `lore-github-oauth` | `client-id`, `client-secret` | `lore-github-oauth-*` | the GitHub OAuth App for UI sign-in, which lore-api runs (ADR-053) |
| `lore-api`, `lore-ui`, `lore-stations` | `ghcr-pull-secret` | `.dockerconfigjson` | `lore-ghcr-pull-secret` | a GitHub token with `read:packages` for the private `ghcr.io/re-cinq/lore-*` images |

**Lore with the floor** (always, on a client install):

| Namespace | Secret | Keys | Source | What it is |
| --------- | ------ | ---- | ------ | ---------- |
| `lore-api`, `lore-stations` | `floor-service-token` | `token` | `lore-floor-service-token` | the floor's `serviceToken`; must equal the value in `floor-api` below |
| `lore-api` | `floor-git-credential-token` | `token` | `lore-floor-git-credential-token` | the token the floor presents when it asks lore-api for a git credential; must equal `gitCredentialToken` below |

**Floor** (namespace `floor`, read by the floor chart; it creates none of them except an empty `agent-secrets`):

| Secret | Keys | What it is |
| ------ | ---- | ---------- |
| `floor-api` | `serviceToken`, `visitTokenSecret`, `gitCredentialToken` | `openssl rand -hex 32` each. `serviceToken` is what every client (Lore, the CLI) authenticates with |
| `floor-postgres` | `connectionString` | `postgres://user:password@host:5432/floor` |
| `agent-secrets` | `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`, optionally `GEMINI_API_KEY`; plus `lore-mcp-auth` = `Bearer <lore-ingest-token>` | the model credential every agent pod runs with, and the header the pod's Lore MCP server is called with. The cluster agent also writes per-visit tokens here |

**Optional:** `lore-stations/lore-reviewer-app` (a second GitHub App that approves pull requests for auto-merge), `lore-gemini-api-key`, and the OAuth + cookie secrets of Grafana, Headlamp and Utopia (cookie secrets are exactly 16, 24 or 32 bytes).

### 1.6 External accounts

| Account | Who creates it | What Lore needs |
| ------- | -------------- | --------------- |
| **GitHub App**, installed on the organization | the client's GitHub org owner | permissions: Contents read/write, Issues read/write, Pull requests read/write, Checks read, Metadata read, Webhooks (repository hooks) read/write. Subscribe to no events on the App itself: lore-api installs a hook per repository (`POST /api/repos/:o/:r/webhook/ensure`) for `pull_request`, `pull_request_review`, `pull_request_review_comment`, `issue_comment`, `issues`, `repository`, `push`, `release`, `create`, `check_suite` (`apps/lore-api/src/work/webhook/webhook-status.ts`). Values: App ID, installation ID, private key PEM, the App's slug |
| **GitHub OAuth App** for UI sign-in | same | callback `https://<lore_api host>/api/auth/callback` (lore-api's, not the UI's); sign-in is restricted to members of `GITHUB_ORG` |
| lore-reviewer GitHub App (optional) | same | Pull requests read/write, Contents read, Checks read, Metadata read; no webhook. Lets the auto-merge loop approve the pull requests Lore's main App opened |
| **Slack app** (optional) | a Slack admin | from `scripts/slack-app-manifest.yaml`: bot scopes `chat:write`, `commands`, `users:read`, `users:read.email`, `reactions:read`; slash command `/lore` and events at `https://<lore_api_url>/api/webhook/slack` and `/slack-events` |
| **ghcr.io read token** | the Lore team (re-cinq) | a `read:packages` token for the private images `ghcr.io/re-cinq/{lore-api,lore-mcp,lore-ui,lore-stations}`. The floor and subsystem images (`ghcr.io/re-cinq/{floor,ai-agent-controller,ai-agent}`) and the third-party ones (`ghcr.io/cloudnative-pg/postgresql`, `dgraph/standalone`, `curlimages/curl`, `alpine`) are public |
| **Model access** | the client | agent pods: an Anthropic API key, or a Claude Code OAuth token (`claude setup-token`, bills a subscription), optionally a Gemini API key; which key an agent reads is per model family (`clusterAgent.modelSecretKeys`). lore-api and stations: an Anthropic key (or Gemini, or an Ollama endpoint; one use can run on its own vendor through `LORE_<USE>_LLM_PROVIDER` and `LORE_<USE>_LLM_MODEL`) |
| **Embeddings** | see below | |

**Embeddings are Vertex AI only, today.** `LORE_EMBEDDING_PROVIDER` knows one vendor: Vertex `text-embedding-005`, 768 dimensions, reached through Google application-default credentials and a GCP project (`libs/shared/src/outbound/embeddings/select-embedding-provider.ts`). Without it Lore starts and runs, but every vector column stays empty and search falls back to keywords, which the evals put far below hybrid search. A client not on GCP has two options: a GCP project used for nothing but Vertex, with a service-account key mounted in lore-api (against this repo's no-long-lived-credentials rule, so a conscious exception), or a second `EmbeddingProvider` for the client's vendor at 768 dimensions (Azure OpenAI `text-embedding-3-small` fits), which is a code change tracked under [Known rough edges](#known-rough-edges).

### 1.7 Who does what, by cloud

| Need | Client cluster (Azure, AKS) | Our GKE (terraform in `infra/terraform/`) |
| ---- | --------------------------- | ----------------------------------------- |
| cluster | infra team: AKS 1.27+, Azure CNI with network policy, node pools per 1.1, a ReadWriteOnce StorageClass (`managed-csi`), Workload Identity if ESO is used | GKE Autopilot, looked up by name; Dataplane V2 |
| ingress, TLS, DNS | infra team: ingress-nginx, cert-manager + ClusterIssuer, DNS records, public IP | `nginx-ingress`, `letsencrypt-prod`, external-dns |
| secrets | infra team: Azure Key Vault + ESO `ClusterSecretStore`, or values handed over; Lore team: Secrets per 1.5 | GCP Secret Manager + ESO + Workload Identity |
| Lore Postgres | infra team: Flexible Server with `vector`, or CNPG operator; Lore team: schema | CNPG `Cluster` in `lore-db`, backups to GCS |
| floor Postgres | infra team: a second database + role | same |
| Dgraph | infra team: a 50Gi volume class; Lore team: the manifest (4.1) | `lore-dgraph.tf` |
| model credentials | client: keys into the vault | GCP Secret Manager |
| embeddings | decision needed (1.6) | Vertex via `roles/aiplatform.user` on the lore-api service account |
| traces | nothing; lore-api disables the exporter when Cloud Trace is unavailable | Cloud Trace |
| cost pages | `/spend` shows the pod-hour estimate only | BigQuery billing export (`enable_gcp_billing_export`) |
| deploys | the Lore team's laptops with namespace-scoped kubeconfigs, `helm upgrade --install` | GitHub Actions through Workload Identity Federation, plus `terraform apply` from `main` |

### 1.8 Operator's machine (Lore team)

kubectl, Helm 3.8+, `gh`, `psql`, and a kubeconfig scoped to the namespaces in 1.1. For the laptop install in section 6: git, Node.js 18+, Claude Code. Terraform 1.5+ and `gcloud` only for our own GKE path (4.2).

## 2. Install A: cluster add-ons

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

Then the `ClusterSecretStore` for the client's vault (ours is in `infra/terraform/eso.tf`), and the namespaces:

```bash
kubectl create namespace floor
for ns in lore-api lore-ui lore-stations lore-db lore-floor lore-dgraph; do kubectl create namespace "$ns"; done
```

## 3. Install B: the floor

Follow [floor/docs/install.md](https://github.com/re-cinq/floor/blob/main/docs/install.md) (the chart's every value: [its README](https://github.com/re-cinq/floor/blob/main/deploy/chart/README.md)). What Lore needs set on top of that guide:

```bash
kubectl -n floor create secret generic floor-api \
  --from-literal=serviceToken="$(openssl rand -hex 32)" \
  --from-literal=visitTokenSecret="$(openssl rand -hex 32)" \
  --from-literal=gitCredentialToken="$(openssl rand -hex 32)"
kubectl -n floor create secret generic floor-postgres \
  --from-literal=connectionString='postgres://floor:<password>@<host>:5432/floor'

helm install floor oci://ghcr.io/re-cinq/charts/floor --version <release> --namespace floor \
  --set api.baseUrl=http://floor-api.floor.svc.cluster.local:8080 \
  --set api.existingSecret=floor-api \
  --set postgres.existingSecret=floor-postgres --set postgres.secretKey=connectionString \
  --set api.gitCredentialUrl=http://lore-api.lore-api.svc.cluster.local:3000/api/floor/git-credential \
  --set subsystem.enabled=true \
  --set agentNetworkPolicy.nodeLocalDnsAddress=<address from 1.1, or ""> \
  -f floor-extra-egress.yaml
```

`floor-extra-egress.yaml` opens the one in-cluster door the agent pods need beyond the floor itself, the Lore MCP gateway and skills registry:

```yaml
agentNetworkPolicy:
  extraEgress:
    - to:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: lore-api } }
          podSelector: { matchLabels: { app: lore-mcp-gateway } }
      ports:
        - { protocol: TCP, port: 8080 }
```

Then the model credential and the Lore header into `agent-secrets`, which the chart created empty and keeps across upgrades:

```bash
kubectl -n floor patch secret agent-secrets --type merge -p '{"stringData":{
  "ANTHROPIC_API_KEY":"sk-ant-...",
  "lore-mcp-auth":"Bearer <the lore-ingest-token value>"}}'
```

A Claude OAuth token instead of an API key goes under `CLAUDE_CODE_OAUTH_TOKEN` with `--set clusterAgent.modelSecretKeys=claude=CLAUDE_CODE_OAUTH_TOKEN`. Add `--skip-crds` when the ai-agent-subsystem CRDs are already on the cluster, and `--set subsystem.enabled=false` when its controller already runs there. Lore puts its pipeline files to the floor itself at every lore-api boot (`apps/lore-api/src/work/floor/seed-floor-pipelines.ts`), so `pipelines.existingConfigMap` stays empty. Check: `kubectl -n floor get pods` shows two api pods, the cluster agent, the subsystem controller and a completed migration Job.

## 4. Install C: Lore

### 4.1 Any Kubernetes, with Helm (a client cluster)

1. **Secrets.** Create every row of 1.5 in its namespace, as plain Secrets or `ExternalSecret` objects. Use `infra/terraform/external-secrets.tf` as the list of names and keys.
2. **Postgres.** Point at the database from 1.3 and apply the baseline schema once. The `setup-*.sh` scripts reach Postgres through `kubectl exec` into the CNPG primary (`lore-db-1` in `lore-db`); against a managed server, run them through the same shim `scripts/infra/setup-local-schema.sh` uses for Docker, pointed at `psql` instead:

   ```bash
   scripts/infra/setup-db.sh            # in-cluster CNPG only: creates the Cluster CR and the roles
   scripts/infra/setup-pipeline-schema.sh
   ```

   The incremental migrations run on their own, as a Helm hook of every deploy.

3. **Dgraph.** It has no chart; apply the Service and StatefulSet in `infra/terraform/lore-dgraph.tf` as plain YAML (namespace `lore-dgraph`, headless Service `lore-dgraph-alpha` on 8080 and 9080, 50Gi volume, memory limit 16Gi), then the schema job, which runs `scripts/infra/setup-memory-dgraph-schema.sh` and `setup-spec-trace-schema.sh` with `DGRAPH_HTTP=http://lore-dgraph-alpha.lore-dgraph.svc.cluster.local:8080`.
4. **Ingresses.** The subcharts render none; create one Ingress per hostname of 1.4 (ours are `infra/terraform/{lore-api,lore-ui,lore-mcp,event-router}.tf`): `lore-api:3000` at `/`, `lore-ui:3000` at `/`, `lore-mcp-gateway:8080` at `/`, and on the webhook host the exact path `/api/events` to `lore-api:3000` with `nginx.ingress.kubernetes.io/rewrite-target: /api/webhook/github` and a 25m body size. The API ingress needs `proxy-read-timeout` and `proxy-send-timeout` of 3600 for the WebSocket.
5. **Values.** Write `lore-values.yaml` with the same keys terraform feeds the umbrella in `infra/terraform/lore-platform.tf`, which is the authoritative list. The ones that change per install:

   ```yaml
   lore-api:
     env:
       LORE_DB_HOST: <postgres host>          # lore-db-rw.lore-db.svc.cluster.local in-cluster
       LORE_DGRAPH_HTTP: http://lore-dgraph-alpha.lore-dgraph.svc.cluster.local:8080
       LORE_MCP_URL: http://lore-mcp-gateway.lore-api.svc.cluster.local:8080/mcp
       LORE_WEBHOOK_URL: https://<lore_event_router_hostname>/api/events
       LORE_API_URL: https://<lore_api host>
       LORE_UI_URL: https://<lore_ui_hostname>
       GITHUB_ORG: <org>                       # also the org whose members may sign in
       LORE_EVAL_LLM_PROVIDER: anthropic       # vertex only on GCP
       LORE_EVAL_LLM_MODEL: <model>
     githubOAuthSecret:
       name: lore-github-oauth
     floor:
       enabled: true
       skillsUrl: http://lore-mcp-gateway.lore-api.svc.cluster.local:8080/skills
   lore-ui:
     env:
       LORE_DB_HOST: <postgres host>
       GITHUB_APP_SLUG: <app slug>
       LORE_API_PUBLIC_URL: https://<lore_api host>   # where the browser reaches lore-api: the sign-in redirects there
       LORE_WS_URL: wss://<lore_api host>/api/ws
   lore-stations:
     env:
       LORE_DB_HOST: <postgres host>
       LORE_UI_URL: https://<lore_ui_hostname>
     floor:
       enabled: true
   lore-db-helm:
     ownershipReconciler:
       enabled: false                          # true only with an in-cluster CNPG cluster named lore-db
   ```

   `GCP_PROJECT` and `LORE_LOG_BUCKET` stay unset off GCP.

6. **Install.**

   ```bash
   helm upgrade --install lore-platform infra/terraform/modules/gke-mcp/lore-platform \
     -n lore-floor -f lore-values.yaml \
     --set-string lore-api.image.tag=<tag> --set-string lore-ui.image.tag=<tag> \
     --set-string lore-stations.image.tag=<tag> --set-string lore-mcp-gateway.image.tag=<tag>
   ```

   Image tags are the short SHA of a `main` commit or a release; `latest` is a never-used default. Upgrades are the same command with new tags; the migrations hook runs first.

### 4.2 Our own GKE, with terraform

Our reference install. `infra/terraform/` reads an existing GKE cluster by name and creates the namespaces, ESO + its `ClusterSecretStore`, the ExternalSecrets, the ingresses, the CloudNativePG cluster, Dgraph, the floor's NetworkPolicy and `agent-secrets` entry, and one `helm_release.lore_platform`. It does **not** create the floor or the ai-agent-subsystem: install the floor (section 3) before the apply, with `enable_external_floor = true` in `terraform.tfvars`, or the apply fails on the `floor` namespace it targets.

```bash
git clone https://github.com/re-cinq/lore.git && cd lore
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars   # identifiers, hostnames, enable_* gates; nothing secret
gh variable set GCP_PROJECT_ID --body "your-gcp-project-id"                   # CI deploys need it

cd infra/terraform && terraform init
terraform apply -target=google_secret_manager_secret.lore   # 1. the empty secret containers
../../scripts/infra/seed-secrets.sh                          # 2. seed them (idempotent; prompts for the empty ones)
terraform apply                                              # 3. everything else
```

Two applies, because `lore-db` reads the database password out of Secret Manager at plan time. Later runs need only the third command. Hostname variables default to empty, which disables the matching ingress: omitting `lore_event_router_hostname` leaves GitHub with nowhere to deliver, and omitting `lore_mcp_url` leaves agent recipes without an MCP endpoint. Secret values are never terraform inputs ([managing-secrets.md](managing-secrets.md)). Then the baseline schema:

```bash
scripts/infra/setup-db.sh
scripts/infra/setup-pipeline-schema.sh
```

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

> **Want the whole stack on your laptop instead?** `npm start` from the repo root brings up Docker Postgres + Dgraph and runs the web UI, API, stations and MCP server locally with live reload, no remote backend needed. To sign into the web UI you create a one-time GitHub OAuth app; full steps in [Run the full stack locally](building-lore/contributing.md#run-the-full-stack-locally).

## 7. Onboard repos

**Via UI:** `https://<lore_ui_hostname>/onboard`

**Via CLI:** `claude "onboard your-org/your-repo to lore"`

## Verify

```bash
# Lore's deployments, one namespace at a time
for ns in lore-api lore-ui lore-db lore-stations lore-dgraph; do
  echo "== $ns"; kubectl get deployments,statefulsets -n "$ns"
done
curl -s https://<lore_api host>/healthz

# The floor and the ai-agent-subsystem it carries
kubectl -n floor get pods
kubectl get crd agents.agents.re-cinq.com stations.agents.re-cinq.com agentdefinitions.agents.re-cinq.com
kubectl -n floor exec deploy/floor-api -- wget -qO- http://localhost:8080/healthz

# Lore sees the floor: the run list reads from it
curl -s -H "Authorization: Bearer <lore-ingest-token>" https://<lore_api host>/api/floor-runs | head -c 300

# End to end: on an onboarded repo, open an issue with a `priority:medium` label;
# the implementation loop picks it up and a run appears at /assembly-runs
```

## Upgrading

Any Kubernetes: section 4.1 step 6 with new image tags; the floor with `helm upgrade floor oci://ghcr.io/re-cinq/charts/floor --version <release> -n floor --reuse-values`. Our GKE: `git pull && cd infra/terraform && terraform apply`; CI builds and deploys every push to `main`.

## Disaster recovery

Our GKE:

```bash
cd infra/terraform && terraform destroy && terraform apply
```

`terraform destroy` refuses while the secret containers carry `prevent_destroy`, deliberately, since destroying them takes every historical version of every live credential with them. To tear the secrets down too, drop the `lifecycle` block in [`secrets.tf`](../infra/terraform/secrets.tf) first, as a separate reviewed commit. Otherwise `-target` the rest of the stack and leave the secrets standing; a rebuilt platform re-attaches to them with no re-seeding.

All state is in terraform. Secrets are in the vault. Everything else is in the two Postgres databases and Dgraph: back those up.

## Known rough edges

What a non-re-cinq install hits today. Each is an open issue; the doc keeps the list until the fix lands.

1. **Helm-only install is assembled by hand** ([#3902](https://github.com/re-cinq/lore/issues/3902)). The ingresses, the Dgraph StatefulSet, the ExternalSecrets and the floor NetworkPolicy exist only as terraform (`infra/terraform/*.tf`); no subchart renders an Ingress, and the umbrella values default the Postgres host to the CNPG Service and carry `GCP_PROJECT`. Section 4.1 lists what to apply by hand until the chart grows optional templates for them.
2. **Embeddings are Vertex only** ([#3903](https://github.com/re-cinq/lore/issues/3903), see 1.6). A second `EmbeddingProvider` at 768 dimensions is the fix.
3. The schema scripts `scripts/infra/setup-*.sh` reach Postgres through `kubectl exec` into a CNPG pod; a managed server needs the `psql` shim ([#3904](https://github.com/re-cinq/lore/issues/3904)).
4. Three terraform gaps ([#3905](https://github.com/re-cinq/lore/issues/3905)): `lore-stations` references `ghcr-pull-secret` but it is mirrored only into `lore-api`, `lore-ui` and `utopia`; `lore-admin-token` is read by an ExternalSecret but `secrets.tf` creates no container for it; lore-api's Cloud Trace exporter has no `roles/cloudtrace.agent` grant, so traces are silently off even on GCP.
5. The ESO `ClusterSecretStore`, the allowed sign-in domain `re-cinq.com` (Grafana, Headlamp, Utopia), the terraform state bucket and the CI deployer service account are hardcoded to our environment, and `infra/terraform/modules/gke-mcp/main.tf` describes a cluster nothing creates ([#3906](https://github.com/re-cinq/lore/issues/3906)).

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
