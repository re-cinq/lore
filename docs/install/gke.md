# Install Lore on Google GKE

You will have Lore, the floor and the agent subsystem running on a GKE cluster, behind Traefik with certificates from cert-manager. Lore's own model calls use Vertex AI or an Anthropic key. Utopia, the knowledge graph, is an optional section with Google sign-in. Plan on two hours, longer if DNS or IAM is slow.

## Before you start

| You need | Who provides it |
| -------- | --------------- |
| GKE 1.27 or newer with Workload Identity, Helm 3.8 or newer, `kubectl` with cluster-admin once (the operators install CRDs) | your cloud admin |
| A network plugin that enforces NetworkPolicy (GKE Dataplane V2 does). Without enforcement the agent pods' egress rules bind nothing | your cloud admin |
| A default StorageClass for ReadWriteOnce volumes | your cloud admin |
| Room for the workloads: 3 nodes of 8 vCPU and 32 GiB for the platform, 2 of the same size for agents (an estimate from requests and limits, not a measurement) | your cloud admin |
| Three DNS names for one public IP: UI, API, and Utopia if you enable it. A fourth, the MCP gateway, is optional | your cloud admin |
| A GitHub App and an OAuth App ([GitHub setup](../github-setup.md)) | your GitHub organization owner |
| For Vertex: a Google service account with `roles/aiplatform.user`. Or an Anthropic API key | your cloud admin, or you |

Lore calls out only to GitHub and to your model endpoint. Every signed-in member of your GitHub organization is an administrator in Lore today.

## 1. Install the operators

CloudNativePG runs the databases. Traefik is the ingress in this tutorial, and any controller works if it allows request bodies up to 25 MB on the API host (GitHub webhooks) and keeps WebSocket connections open. cert-manager is optional and only issues certificates.

```bash
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo add traefik https://traefik.github.io/charts
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm upgrade --install cnpg cnpg/cloudnative-pg -n cnpg-system --create-namespace --wait
helm upgrade --install traefik traefik/traefik -n traefik --create-namespace \
  --set ingressClass.name=traefik --wait
helm upgrade --install cert-manager jetstack/cert-manager -n cert-manager --create-namespace \
  --set crds.enabled=true --wait
kubectl -n traefik get svc traefik
```

Point the three DNS names at the `EXTERNAL-IP` of that Service. For certificates, create an issuer (`<email>` is where Let's Encrypt writes):

```bash
kubectl apply -f - <<'EOF'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: { name: letsencrypt-prod }
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: <email>
    privateKeySecretRef: { name: letsencrypt-prod }
    solvers: [{ http01: { ingress: { ingressClassName: traefik } } }]
EOF
kubectl get clusterissuer letsencrypt-prod
```

It shows `READY True`. Without cert-manager, remove `clusterIssuer` from the values file in step 3 and create a TLS Secret named `<ingress name>-tls` in each namespace yourself.

## 2. Install the databases

The databases chart creates two PostgreSQL 16 clusters with pgvector and the Secrets that hold their passwords. It uses the cluster's default StorageClass unless you set `defaults.storageClass`.

```bash
helm upgrade --install lore-databases oci://ghcr.io/re-cinq/charts/lore-databases --version 1.1.0 \
  -n lore-db --create-namespace
kubectl -n lore-db wait --for=condition=Ready cluster/lore-db cluster/floor-db --timeout=300s
```

The wait prints `condition met` for both.

**Alternative: Cloud SQL.** Skip this step. Create a PostgreSQL 16 instance with pgvector, a database `lore` owned by a role `lore`, and a database `floor` with its own role. In the values file of step 3 set `secrets.loreDbPassword`, `secrets.floorDbConnectionString` (`postgres://floor:<password>@<host>:5432/floor`) and `LORE_DB_HOST` in the `env:` of lore-api, lore-ui and lore-stations. If the role `lore` may not create the extension, an admin runs `CREATE EXTENSION IF NOT EXISTS vector;` in database `lore` once.

## 3. Fill in the values file

```bash
helm pull oci://ghcr.io/re-cinq/charts/lore-install --version 1.1.0 --untar
cp lore-install/values.gke.example.yaml my-values.yaml
grep -n CHANGE-ME my-values.yaml
```

Replace each placeholder and every `example.com`. The file holds secrets, so keep it out of git.

| Value | What it is |
| ----- | ---------- |
| `secrets.githubApp.*`, `secrets.githubOAuth.*`, `GITHUB_ORG`, `GITHUB_APP_SLUG` | from [GitHub setup](../github-setup.md), with `https://<ui host>` and `https://<api host>` |
| `host:` of every entry under `ingresses`, `LORE_API_URL`, `LORE_UI_URL`, `LORE_WEBHOOK_URL`, `LORE_API_PUBLIC_URL`, `LORE_WS_URL` | your hostnames. `LORE_WS_URL` is `wss://<ui host>/api/ws`, on the UI's host |
| `GCP_PROJECT`, and `serviceAccount.annotations` under `lore-api` | your project, and `iam.gke.io/gcp-service-account: lore-api@<project>.iam.gserviceaccount.com`, the Google service account that holds `roles/aiplatform.user` |
| Utopia lines | see the last section, or set `utopia.enabled` and `lore-platform.lore-api.utopia.enabled` to `false` and delete the `global.oidc`, `utopia` and `secrets.oidc` blocks |

The example sends Lore's own calls to Vertex AI (Gemini, and `text-embedding-005` for search). Your admin lets the Kubernetes service account `lore-api` in namespace `lore-api` act as that Google service account (Workload Identity). The stations call Vertex too: add the same annotation under `lore-platform.lore-stations.serviceAccount.annotations`, with the same Google service account or another, and bind the Kubernetes service account `lore-stations` in `lore-stations`. The example sets `LORE_TRACE_EXPORTER: cloud-trace`, and traces stay off unless the Google service account also holds `roles/cloudtrace.agent`.

For an Anthropic key instead of Vertex, set `secrets.anthropicApiKey`, delete the `serviceAccount` block, `GCP_PROJECT` and the `vertex` entries, and also delete `LORE_TRACE_EXPORTER: cloud-trace` unless you want it. Search is then keyword-only until you set `LORE_EMBEDDING_PROVIDER: openai`, `secrets.openaiApiKey`, `OPENAI_BASE_URL` and `LORE_EMBEDDING_MODEL` (768 dimensions), and `/healthz` can report `degraded` with HTTP 200 meanwhile.

**GitHub Enterprise.** For a Server or a data-residency tenant (`<name>.ghe.com`), create both GitHub apps there and uncomment `GITHUB_HOST` in the three `env:` blocks, with the bare host name. A Server on a private address needs a rule under `floor.agentNetworkPolicy.extraEgress`, which `values.yaml` shows. github.com needs nothing.

Check the file offline:

```bash
helm template lore oci://ghcr.io/re-cinq/charts/lore-install --version 1.1.0 -n lore-floor -f my-values.yaml > /dev/null && echo ok
```

## 4. Install Lore

```bash
kubectl config current-context
helm upgrade --install lore oci://ghcr.io/re-cinq/charts/lore-install --version 1.1.0 \
  -n lore-floor --create-namespace -f my-values.yaml --wait --timeout 15m
```

The release must be named `lore` and live in `lore-floor`. It ends with `STATUS: deployed`. Tokens you left empty are generated and kept.

## 5. Give the agents their model key

The floor owns `agent-secrets` and creates it empty. Agent pods read their model credentials from it, and the MCP gateway asks them for `lore-mcp-auth`. The token is read from the cluster and never printed.

```bash
read -rs ANTHROPIC_API_KEY
MCP_TOKEN=$(kubectl -n lore-api get secret lore-mcp-auth-token -o jsonpath='{.data.token}' | base64 -d)
kubectl -n lore-floor patch secret agent-secrets --type merge \
  -p "{\"stringData\":{\"ANTHROPIC_API_KEY\":\"${ANTHROPIC_API_KEY}\",\"lore-mcp-auth\":\"Bearer ${MCP_TOKEN}\"}}"
unset ANTHROPIC_API_KEY MCP_TOKEN
```

It prints `secret/agent-secrets patched`. A Gemini key goes under `GEMINI_API_KEY`. A Claude Code OAuth token goes under `CLAUDE_CODE_OAUTH_TOKEN`, with `floor.clusterAgent.modelSecretKeys: claude=CLAUDE_CODE_OAUTH_TOKEN` in your values file. A change reaches new runs only.

## Verify the install

```bash
kubectl get pods -A
curl -s https://<api host>/healthz
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://<ui host>/
curl -s -i -X POST https://<api host>/api/webhook/github -H 'x-hub-signature-256: sha256=deadbeef' -H 'x-github-event: ping' -d '{}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<mcp host>/mcp
```

| Check | Good result |
| ----- | ----------- |
| pods | all `Running` or `Completed`: `lore-floor-api`, `lore-floor-cluster-agent`, `agent-controller` (`lore-floor`), `lore-api`, `lore-mcp-gateway`, `lore-ui`, `lore-stations`, `lore-dgraph-alpha-0`, and the two databases |
| `/healthz` | `{"status":"ok"}` |
| UI | `307` to `/auth/signin` |
| webhook, bad signature | `401` |
| MCP gateway, no token | `401` (skip it if you left the MCP host out) |

Then sign in at `https://<ui host>` and onboard a repository at `/onboard`. Lore creates the repository's webhook itself, at `https://<api host>/api/webhook/github`, so GitHub must reach that host.

## Run on a management node pool

Label and taint a pool, then add to `my-values.yaml` (and to a `databases-values.yaml` as `global:` the same way, then run step 2 with `-f databases-values.yaml`):

```yaml
global:
  nodeSelector: { pool: management }
  tolerations: [{ key: pool, operator: Equal, value: management, effect: NoSchedule }]
```

This places every Lore, floor, subsystem and Utopia controller. Databases and Dgraph follow it only if their disks can move, which cloud disks do within a zone. Agent run pods are not covered. A taint on the pool keeps them off it.

## Backups to Cloud Storage

Backups of the in-cluster databases go to a bucket through the CloudNativePG barman-cloud plugin, which you install beside the operator:

```bash
kubectl apply -f https://github.com/cloudnative-pg/plugin-barman-cloud/releases/download/v0.11.0/manifest.yaml
```

Your admin gives the databases' Kubernetes service accounts (`lore-db` and `floor-db` in `lore-db`) write access to the bucket through Workload Identity. In `databases-values.yaml`, then run step 2 again with `-f databases-values.yaml`:

```yaml
defaults:
  serviceAccountAnnotations: { iam.gke.io/gcp-service-account: <service account>@<project>.iam.gserviceaccount.com }
lore:
  backup:
    schedule: "0 0 2 * * *"
    retention: 30d
    configuration:
      destinationPath: gs://<bucket>/lore-db
      googleCredentials: { gkeEnvironment: true }
```

Repeat the block under `floor:` with another path. Dgraph runs as one pod with one volume and has no backup of its own. It is being removed from Lore.

## Optional: Utopia with Google sign-in

Utopia mirrors each repository's specs and ADRs into a knowledge graph. Create an OAuth client for a web application in your Google Cloud project with the redirect URI `https://<utopia host>/api/v1/auth/oidc/callback`. The example's `global.oidc.issuer` is `https://accounts.google.com`. Set `allowedDomains` (the email domains that may sign in) in `global.oidc` and again in `utopia.oidc`, since the chart refuses a mismatch. The client ID and secret go in `secrets.oidc`. After the install, sign in at `https://<utopia host>` and, under Administration, tab Models, enter the chat and embedding endpoints (Base URL, Model, API key), or Utopia stores documents and extracts nothing. Lore's write token for Utopia is made once by hand ([managing-secrets.md](../managing-secrets.md#the-utopia-write-token-lore-utopia-lore-api-token)). Utopia's database has its own backup setting, `utopia.database.backup.objectStore`.

## Upgrade

```bash
helm upgrade --install lore oci://ghcr.io/re-cinq/charts/lore-install --version <new version> \
  -n lore-floor -f my-values.yaml --wait --timeout 15m
```

Compare the new chart's `values.gke.example.yaml` with your file first. An upgrade keeps every Secret and both databases. Generated tokens are read back, and a Secret you made yourself is never touched. Upgrade `lore-databases` the same way when its version changes.

## Remove

`helm uninstall lore -n lore-floor` deletes the release, including the `lore-dgraph` namespace and the Dgraph volume. The namespaces `lore-api`, `lore-ui`, `lore-stations` and `lore-floor` stay. `helm uninstall lore-databases -n lore-db` deletes the two clusters, so check `kubectl -n lore-db get pvc`. Its namespaces and the password Secrets it wrote stay. Utopia's volumes live in `lore-floor`.

## If it fails

| Message | Cause and fix |
| ------- | ------------- |
| `utopia.oidc.issuer and utopia.oidc.allowedDomains must repeat global.oidc until Utopia reads the shared block` | The two blocks differ. Make them equal. |
| `Secret lore-api/github-app-credentials does not exist: set secrets.githubApp, or create it yourself with the keys app-id, installation-id, private-key` | You emptied a group and made no Secret. Fill it or create the Secret. |
| `secrets.ingestToken is 12 characters; it must be at least 32 (openssl rand -hex 32)` (any token you set yourself) | Use a longer token, or leave it empty and the chart generates one. |

## What this tutorial has not been tested on

The charts were installed and checked on a local kind cluster only, and this page's GKE values were rendered offline with `helm template`, never applied. Nobody at re:cinq has run these steps on GKE as a client would, nor cert-manager certificate issuance, Traefik on GKE, backups to Cloud Storage, Workload Identity for Lore's service accounts, Vertex AI through these values, Google sign-in to Utopia, Cloud SQL, GitHub Enterprise Server or a `ghe.com` tenant, or anything that needs real GitHub credentials or a model: sign-in, webhook delivery and an agent run.
