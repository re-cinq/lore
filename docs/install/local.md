# Try Lore on one machine with kind

You will have the whole platform running in a three-node kind cluster on your machine, with the web UI at `http://lore.localtest.me`. It has no TLS and no DNS setup: `*.localtest.me` resolves to 127.0.0.1, and kind maps port 80 to Traefik. Plan on half an hour, most of it image pulls. This is a trial. It is not sized or hardened for work.

GitHub cannot reach your machine, so webhooks do not arrive unless you add a tunnel. Sign-in, the UI and the API work.

## Before you start

| You need | Who provides it |
| -------- | --------------- |
| Docker, `kind`, `kubectl`, Helm 3.8 or newer, `curl` | you |
| Docker memory comfortably above 4 GiB (this example lets Dgraph use up to 4 GiB) | you |
| A GitHub App and an OAuth App on your organization, made with the URLs in step 3 ([GitHub setup](../github-setup.md)) | your GitHub organization owner |
| An Anthropic API key, for Lore's own model calls | you |

## 1. Create the cluster

kind's default network plugin enforces NetworkPolicy, so the policies Lore ships are tested here. Save as `kind-config.yaml`:

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraPortMappings:
      - { containerPort: 30080, hostPort: 80, protocol: TCP }
  - role: worker
  - role: worker
```

```bash
kind create cluster --name lore-trial --config kind-config.yaml --wait 180s
kubectl config current-context
```

The second command must print `kind-lore-trial`. Every command below changes the cluster that this prints, so check it again in any new terminal and before step 5. If it prints anything else, stop and run `kubectl config use-context kind-lore-trial`.

## 2. Install the operators

Lore needs CloudNativePG for its databases and an ingress controller. The versions below are the ones tested. Save as `traefik-values.yaml`:

```yaml
ingressClass: { enabled: true, isDefaultClass: false, name: traefik }
providers:
  kubernetesIngress: { enabled: true, publishedService: { enabled: false } }
  kubernetesCRD: { enabled: false }
service:
  spec: { type: NodePort }
ports:
  web: { nodePort: 30080 }
  websecure: { expose: { default: false } }
deployment: { replicas: 1 }
```

```bash
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo add traefik https://traefik.github.io/charts
helm repo update
helm upgrade --install cnpg cnpg/cloudnative-pg --version 0.29.2 -n cnpg-system --create-namespace --wait --timeout 5m
helm upgrade --install traefik traefik/traefik --version 42.4.1 -n traefik --create-namespace -f traefik-values.yaml --wait --timeout 5m
```

Each command ends with `STATUS: deployed`.

## 3. Create the GitHub App and the OAuth App

Follow [GitHub setup](../github-setup.md) with these values: `<ui host>` is `lore.localtest.me`, `<api host>` is `lore-api.localtest.me`, and the URLs start with `http://`. You come away with an App ID, an installation ID, a private key file, the App's slug, an OAuth client ID and secret, and the organization name.

## 4. Fill in the values file

These commands install the latest release. To install a known one, add `--version X.Y.Z` to every command that names `lore-databases` or `lore-install`, the same version for both; the releases page of the Lore repository lists them, and a release `vX.Y.Z` is chart version `X.Y.Z`.

```bash
helm pull oci://ghcr.io/re-cinq/charts/lore-install --untar
cp lore-install/values.local.example.yaml my-values.yaml
grep -n CHANGE-ME my-values.yaml
```

The last command lists the header comment and eight places: the App ID, the installation ID, the private key (paste the whole PEM under `privateKey: |`, indented like the placeholder), the OAuth client ID and secret, `anthropicApiKey`, `GITHUB_ORG` and `GITHUB_APP_SLUG`. Replace each. The file holds secrets, so keep it out of git. Check it:

```bash
grep -v '^ *#' my-values.yaml | grep -c CHANGE-ME
```

It prints `0`. The chart stops the install while a `CHANGE-ME` is left, and also for a token you set shorter than 32 characters. The images are public, so no registry credential is needed.

## 5. Install the databases, then Lore

The databases chart creates two PostgreSQL clusters and the Secrets that hold their passwords. Save as `databases-values.yaml`, which shrinks them for a laptop:

```yaml
defaults:
  size: 2Gi
  resources:
    requests: { cpu: 100m, memory: 256Mi }
    limits: { memory: 1Gi }
```

```bash
kubectl config current-context
helm upgrade --install lore-databases oci://ghcr.io/re-cinq/charts/lore-databases \
  -n lore-db --create-namespace -f databases-values.yaml
kubectl -n lore-db wait --for=condition=Ready cluster/lore-db cluster/floor-db --timeout=300s
```

The wait prints `cluster.postgresql.cnpg.io/lore-db condition met` and the same for `floor-db`. Then install Lore. The release must be named `lore` and live in `lore-floor`, or the chart refuses it.

`lore-databases` already created `lore-floor`. With your own databases, create the namespace separately first if it is missing. [Namespace setup and upgrade safety](../../deploy/install/README.md#namespace-safety-on-upgrade).

```bash
helm upgrade --install lore oci://ghcr.io/re-cinq/charts/lore-install \
  -n lore-floor -f my-values.yaml --wait --timeout 9m
```

It ends with `STATUS: deployed`. The migrations of the floor and of Lore run before the pods start.

## 6. Give the agents their model key

The floor owns the Secret `agent-secrets` and creates it empty. Put the key for agent pods into it, together with the token the MCP gateway asks agent pods for. The commands never print either value.

```bash
read -rs ANTHROPIC_API_KEY
MCP_TOKEN=$(kubectl -n lore-api get secret lore-mcp-auth-token -o jsonpath='{.data.token}' | base64 -d)
kubectl -n lore-floor patch secret agent-secrets --type merge \
  -p "{\"stringData\":{\"ANTHROPIC_API_KEY\":\"${ANTHROPIC_API_KEY}\",\"lore-mcp-auth\":\"Bearer ${MCP_TOKEN}\"}}"
unset ANTHROPIC_API_KEY MCP_TOKEN
```

The first command waits for you to paste the key and press Enter. The patch prints `secret/agent-secrets patched`. A change reaches new runs only.

## Verify the install

```bash
kubectl get pods -A
```

Every pod is `Running` or `Completed`. The ones to look for are `lore-floor-api`, `lore-floor-cluster-agent` and `agent-controller` in `lore-floor`, `lore-api` and `lore-mcp-gateway` in `lore-api`, `lore-ui`, `lore-stations`, `lore-dgraph-alpha-0`, and `lore-db-1` and `floor-db-1` in `lore-db`. Then the public addresses:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://lore.localtest.me/
curl -s http://lore-api.localtest.me/healthz
curl -s -i -X POST http://lore-api.localtest.me/api/webhook/github \
  -H 'content-type: application/json' -H 'x-hub-signature-256: sha256=deadbeef' -H 'x-github-event: ping' -d '{}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://lore-mcp.localtest.me/mcp
```

| Check | Good result |
| ----- | ----------- |
| the UI | `307` and a redirect to `/auth/signin` |
| `/healthz` | `{"status":"ok"}`. It reads `degraded`, still with HTTP 200, when search has no embedding provider (see "Add search by meaning") |
| the webhook with a bad signature | `401`, with a body saying signature verification failed |
| the MCP gateway with no token | `401` |

Last, open `http://lore.localtest.me` and sign in with GitHub. You land in the UI if you are a member of your organization. Every signed-in member is an administrator in Lore today.

### Add search by meaning

Without an embedding endpoint, search is keyword-only. To add one, set `secrets.openaiApiKey` and, under `lore-platform.lore-api.env` and `lore-platform.lore-stations.env`, `OPENAI_BASE_URL` and `LORE_EMBEDDING_MODEL` for any OpenAI-compatible API (Lore asks for 768 dimensions, so the model must accept the `dimensions` parameter). `values.aks.example.yaml` shows the exact lines. Run the upgrade of the next section. Vectors of two models cannot be compared, so choose before you store data you care about.

## Upgrade

See [namespace safety on upgrade](../../deploy/install/README.md#namespace-safety-on-upgrade) before upgrading an installation made with Helm 4 and `--create-namespace`.

```bash
helm upgrade --install lore oci://ghcr.io/re-cinq/charts/lore-install --version <new version> \
  -n lore-floor -f my-values.yaml --wait --timeout 9m
```

Pull the new chart with `--untar` and compare its `values.local.example.yaml` with your file first. An upgrade keeps every Secret and both databases. Tokens you left empty are read back from the cluster, so they do not change. A Secret you created yourself is never touched. Use the same command for a new value in your file.

## Remove

```bash
helm uninstall lore -n lore-floor
helm uninstall lore-databases -n lore-db
```

The first deletes everything in the release, including the `lore-dgraph` namespace and the Dgraph volume. The namespaces `lore-api`, `lore-ui`, `lore-stations`, `lore-db` and `lore-floor`, and the Secrets the databases chart wrote, stay. The second deletes the two database clusters, so check `kubectl -n lore-db get pvc` for volumes left over. To drop everything at once, delete the cluster:

```bash
kind delete cluster --name lore-trial
```

## If it fails

| Message | Cause and fix |
| ------- | ------------- |
| `lore-platform.lore-api.env.GITHUB_ORG still holds the placeholder CHANGE-ME` (the value path differs) | A placeholder is left in `my-values.yaml`. Run `grep -n CHANGE-ME my-values.yaml` and replace it. |
| `Secret lore-api/github-app-credentials does not exist: set secrets.githubApp, or create it yourself with the keys app-id, installation-id, private-key` | You emptied a credential group and made no Secret of your own. Fill the group, or create the Secret with those keys and run the install again. |
| `the release must be named lore and live in lore-floor: helm upgrade --install lore oci://ghcr.io/re-cinq/charts/lore-install -n lore-floor -f <values>` | The release name or the namespace is not `lore` and `lore-floor`. Use `-n lore-floor` and the name `lore`. |

A pod stuck in `Pending` or `OOMKilled` means Docker has too little memory. Raise Docker's limit and run the install again.

## What this tutorial has not been tested on

The charts were installed and checked on a local kind cluster only, on dummy GitHub values: every pod became ready, both migrations ran, and the checks above gave the results shown. We have not run this page with a real GitHub App, so sign-in, webhook delivery and an agent run on a real repository are unproven, and so is anything that needs a model key. We have not run AKS, GKE, certificate issuance by cert-manager, backups to object storage, workload identity, Microsoft Entra sign-in or Microsoft Foundry.
