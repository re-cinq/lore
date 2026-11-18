# Install Lore on Azure AKS

You will have Lore, the floor and the agent subsystem running on an AKS cluster, behind Traefik with certificates from cert-manager, using Microsoft Foundry for models. Utopia, the knowledge graph, is an optional last section. Plan on two hours, longer if DNS or Azure permissions are slow.

## Before you start

| You need | Who provides it |
| -------- | --------------- |
| AKS 1.27 or newer, Helm 3.8 or newer, `kubectl` with cluster-admin once (the operators install CRDs) | your cloud admin |
| A network plugin that enforces NetworkPolicy (the plugin has to enforce it, or the agent pods' egress rules bind nothing) | your cloud admin |
| A default StorageClass for ReadWriteOnce volumes | your cloud admin |
| Room for the workloads: 3 nodes of 8 vCPU and 32 GiB for the platform, 2 of the same size for agents (a sizing estimate from requests and limits, not a measurement) | your cloud admin |
| Three DNS names for one public IP: UI, API, and Utopia if you enable it. A fourth, the MCP gateway, is optional | your cloud admin |
| A GitHub App and an OAuth App ([GitHub setup](../github-setup.md)) | your GitHub organization owner |
| A Foundry resource with a chat deployment and an embedding deployment that returns 768 dimensions, and its key | your cloud admin |

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

The databases chart creates two PostgreSQL 16 clusters with pgvector and the Secrets that hold their passwords. Use the cluster's default StorageClass, or set `defaults.storageClass`. A `databases-values.yaml` is optional; the defaults are 20 GiB and 2 GiB of memory per cluster.

```bash
helm upgrade --install lore-databases oci://ghcr.io/re-cinq/charts/lore-databases --version 1.1.0 \
  -n lore-db --create-namespace
kubectl -n lore-db wait --for=condition=Ready cluster/lore-db cluster/floor-db --timeout=300s
```

The wait prints `condition met` for both. To keep the controllers off the agents' nodes, add `--set global.nodeSelector.pool=management` here and in step 4 (see "Run on a management node pool").

**Alternative: Azure Database for PostgreSQL.** Skip this step. Create a PostgreSQL 16 server, allow-list the extension `vector` in the server parameter `azure.extensions`, and create a database `lore` owned by a role `lore`, and a database `floor` with its own role. In the values file of step 3 set `secrets.loreDbPassword`, `secrets.floorDbConnectionString` (`postgres://floor:<password>@<server>.postgres.database.azure.com:5432/floor`) and `LORE_DB_HOST` in the `env:` of lore-api, lore-ui and lore-stations. If the role `lore` may not create the extension, a server admin runs `CREATE EXTENSION IF NOT EXISTS vector;` in database `lore` once.

## 3. Fill in the values file

```bash
helm pull oci://ghcr.io/re-cinq/charts/lore-install --version 1.1.0 --untar
cp lore-install/values.aks.example.yaml my-values.yaml
grep -n CHANGE-ME my-values.yaml
```

Replace each placeholder and every `example.com`. The file holds secrets, so keep it out of git.

| Value | What it is |
| ----- | ---------- |
| `secrets.githubApp.*`, `secrets.githubOAuth.*`, `GITHUB_ORG`, `GITHUB_APP_SLUG` | from [GitHub setup](../github-setup.md), with `https://<ui host>` and `https://<api host>` |
| `secrets.openaiApiKey`, `OPENAI_BASE_URL` | the Foundry key and `https://<resource>.openai.azure.com/openai/v1`, for Lore's own model calls and embeddings |
| `LORE_FACT_MODEL`, `LORE_EVAL_LLM_MODEL`, `LORE_EMBEDDING_MODEL` | the names of your chat and embedding deployments. Foundry routes by deployment name |
| `host:` of every entry under `ingresses`, `LORE_API_URL`, `LORE_UI_URL`, `LORE_WEBHOOK_URL`, `LORE_API_PUBLIC_URL`, `LORE_WS_URL` | your hostnames. `LORE_WS_URL` is `wss://<ui host>/api/ws`, on the UI's host |
| `floor.agentNetworkPolicy.nodeLocalDnsAddress` | optional. The default `169.254.20.10` lets agent pods reach a NodeLocal DNSCache. If your cluster runs none, set it to `""` so they reach only the cluster's DNS pods. If it runs one on another address, put that address here |
| Utopia lines | see the last section, or set `utopia.enabled` and `lore-platform.lore-api.utopia.enabled` to `false` and delete the `global.oidc`, `utopia` and `secrets.oidc` blocks |

For an Anthropic key instead of Foundry for Lore's own calls, set `secrets.anthropicApiKey` and delete the `OPENAI_*`, `LORE_*_LLM_*` and `LORE_EMBEDDING_*` lines. Search is then keyword-only, and `/healthz` can report `degraded` with HTTP 200.

**GitHub Enterprise.** For a Server or a data-residency tenant (`<name>.ghe.com`), create both GitHub apps there and uncomment `GITHUB_HOST` in the three `env:` blocks, with the bare host name. A Server on a private address needs a rule under `floor.agentNetworkPolicy.extraEgress`, which `values.yaml` shows. github.com needs nothing. Your onboarded repositories' Actions runners must reach the API host.

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

The floor owns `agent-secrets` and creates it empty. Agent pods read their model credentials from it, and the MCP gateway asks them for `lore-mcp-auth`. The token is read from the cluster and never printed. For agents on Foundry, `<codex url>` is `https://<resource>.openai.azure.com/openai/v1` and `<claude url>` ends in `.services.ai.azure.com/anthropic`.

```bash
read -rs FOUNDRY_KEY
MCP_TOKEN=$(kubectl -n lore-api get secret lore-mcp-auth-token -o jsonpath='{.data.token}' | base64 -d)
kubectl -n lore-floor patch secret agent-secrets --type merge -p "{\"stringData\":{
  \"AGENT_PROVIDER\":\"foundry\",
  \"AZURE_OPENAI_BASE_URL\":\"<codex url>\", \"AZURE_OPENAI_API_KEY\":\"${FOUNDRY_KEY}\",
  \"ANTHROPIC_FOUNDRY_BASE_URL\":\"<claude url>\", \"ANTHROPIC_FOUNDRY_API_KEY\":\"${FOUNDRY_KEY}\",
  \"lore-mcp-auth\":\"Bearer ${MCP_TOKEN}\"}}"
unset FOUNDRY_KEY MCP_TOKEN
```

It prints `secret/agent-secrets patched`. A cluster runs one provider. Entra ID sign-in to Foundry is not supported, only keys. Each agent needs a deployment named exactly after its model id, and agents that name Gemini models do not go through Foundry, so change their model on the `/agents` page. For an Anthropic key, set `ANTHROPIC_API_KEY` instead and omit `AGENT_PROVIDER`.

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

Label and taint a pool, then add to `my-values.yaml` (and to the databases chart as `global:` the same way):

```yaml
global:
  nodeSelector: { pool: management }
  tolerations: [{ key: pool, operator: Equal, value: management, effect: NoSchedule }]
```

This places every Lore, floor, subsystem and Utopia controller. Databases and Dgraph follow it only if their disks can move, which cloud disks do within a zone. Agent run pods are not covered. A taint on the pool keeps them off it.

## Azure Workload Identity and backups

A workload identity is a label and an annotation, both set from values. Your cloud admin creates a managed identity and federates it to the Kubernetes service account. For the Azure cost sync on the Spend page, that account is `system:serviceaccount:lore-stations:lore-stations`, the identity needs the Cost Management Reader role, and the file's commented lines under `lore-stations` are the values (`serviceAccount.annotations` with `azure.workload.identity/client-id`, `podLabels` with `azure.workload.identity/use: "true"`, `skipCourierJobs: []`, `LORE_AZURE_COST_SCOPE`).

Backups of the in-cluster databases go to Blob storage through the CloudNativePG barman-cloud plugin, which you install beside the operator:

```bash
kubectl apply -f https://github.com/cloudnative-pg/plugin-barman-cloud/releases/download/v0.11.0/manifest.yaml
```

Then, in `databases-values.yaml`, then add `-f databases-values.yaml` to step 2 and run it again:

```yaml
defaults:
  serviceAccountAnnotations: { azure.workload.identity/client-id: <client id> }
lore:
  backup:
    schedule: "0 0 2 * * *"
    retention: 30d
    configuration:
      destinationPath: https://<account>.blob.core.windows.net/<container>/lore-db
      azureCredentials: { inheritFromAzureAD: true }
```

Repeat the block under `floor:` with another path. The chart sets the annotation on the database service account but has no value for the pod label that Azure Workload Identity also wants, so check that your pods get one. Dgraph runs as one pod with one volume and has no backup of its own. It is being removed from Lore.

## Optional: Utopia with Microsoft Entra sign-in

Utopia mirrors each repository's specs and ADRs into a knowledge graph. Your cloud admin registers an app in your tenant (single tenant) with the redirect URI `https://<utopia host>/api/v1/auth/oidc/callback`, adds the optional ID-token claims `email` and `xms_edov`, and creates a client secret. Utopia opens an account only for a token with a true `xms_edov`.

In the values file, the issuer is `https://login.microsoftonline.com/<tenant GUID>/v2.0`, the GUID and not the domain. Set it in `global.oidc.issuer` and again in `utopia.oidc.issuer`, with the same `allowedDomains` in both, since the chart refuses a mismatch. The client goes in `secrets.oidc`. After the install, sign in at `https://<utopia host>` and, under Administration, tab Models, enter the chat and embedding deployments of your Foundry resource, or Utopia stores documents and extracts nothing. Lore's write token for Utopia is made once by hand ([managing-secrets.md](../managing-secrets.md#the-utopia-write-token-lore-utopia-lore-api-token)).

## Upgrade

```bash
helm upgrade --install lore oci://ghcr.io/re-cinq/charts/lore-install --version <new version> \
  -n lore-floor -f my-values.yaml --wait --timeout 15m
```

Compare the new chart's `values.aks.example.yaml` with your file first. An upgrade keeps every Secret and both databases. Generated tokens are read back, and a Secret you made yourself is never touched. Upgrade `lore-databases` the same way when its version changes.

## Remove

`helm uninstall lore -n lore-floor` deletes the release, including the `lore-dgraph` namespace and the Dgraph volume. The namespaces `lore-api`, `lore-ui`, `lore-stations` and `lore-floor` stay. `helm uninstall lore-databases -n lore-db` deletes the two clusters, so check `kubectl -n lore-db get pvc`. Its namespaces and the password Secrets it wrote stay. Utopia's volumes live in `lore-floor`.

## If it fails

| Message | Cause and fix |
| ------- | ------------- |
| `utopia.oidc.issuer and utopia.oidc.allowedDomains must repeat global.oidc until Utopia reads the shared block` | The two blocks differ. Make them equal. |
| `Secret lore-api/github-app-credentials does not exist: set secrets.githubApp, or create it yourself with the keys app-id, installation-id, private-key` | You emptied a group and made no Secret. Fill it or create the Secret. |
| The migration Job fails on a managed server (`kubectl -n lore-ui logs job/lore-ui-migrate`) | Its log prints the statement `CREATE EXTENSION IF NOT EXISTS vector;`. Allow-list `vector`, have an admin run it, and run step 4 again. |

An agent run that gets a 404 from Foundry has no deployment named after the agent's model id.

## What this tutorial has not been tested on

The charts were installed and checked on a local kind cluster only, and this page's AKS values were rendered offline with `helm template`, never applied. Nobody at re:cinq has run AKS, cert-manager certificate issuance, Traefik on AKS, backups to Azure Blob, Azure Workload Identity, Microsoft Entra sign-in to Utopia, Microsoft Foundry, GitHub Enterprise Server or a `ghe.com` tenant, managed PostgreSQL on Azure, or anything that needs real GitHub credentials or a model: sign-in, webhook delivery and an agent run.
