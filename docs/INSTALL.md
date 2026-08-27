# Installing Lore

## Prerequisites

- GCP project with:
  - GKE cluster (tested with Autopilot)
  - Cloud KMS API enabled
  - Secret Manager API enabled
- GitHub App configured with:
  - Repository read/write permissions
  - Issues read/write permissions
  - Pull requests read/write permissions
  - Webhooks
- Terraform >= 1.5
- kubectl + helm
- gh CLI (GitHub CLI)

## Step 1: Clone and Configure

```bash
git clone https://github.com/re-cinq/lore.git
cd lore

# Copy example and fill in your values. Nothing in it is secret.
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
```

`terraform.tfvars` holds only identifiers, hostnames, and feature gates —
Terraform loads that filename automatically, so no `-var-file` flag is needed.

**Secret values are not Terraform inputs.** They live in GCP Secret Manager;
Terraform declares the containers and resolves them by name. You seed them in
Step 3, after the containers exist. See
[rotating-secrets.md](rotating-secrets.md) for the reasoning and the rotation
procedure.

| Secret (GCP Secret Manager name) | Description |
|----------|-------------|
| `lore-github-app-id` | GitHub App ID |
| `lore-github-app-private-key` | GitHub App private key (PEM) |
| `lore-github-app-installation-id` | GitHub App installation ID |
| `lore-anthropic-api-key` | Anthropic API key for Claude |
| `lore-db-password` | PostgreSQL password |
| `lore-ingest-token` | Shared token for API auth |
| `lore-webhook-secret` | HMAC secret for verifying inbound GitHub/Slack webhooks |
| `lore-agent-internal-token` | Internal token the ai-agent-subsystem uses to authenticate to the API |
| `lore-slack-signing-secret` | Slack request-signing HMAC (verifies the /lore command) |
| `lore-slack-bot-token` | Slack bot token for posting task results |
| `lore-github-oauth-client-id` | GitHub OAuth App client ID (for UI login) |
| `lore-github-oauth-client-secret` | GitHub OAuth App client secret |
| `lore-nextauth-secret` | Random string for NextAuth session encryption |
| `lore-ghcr-pull-secret` | `.dockerconfigjson` for GHCR pull access |

## Step 2: Set GitHub Actions Variable

```bash
gh variable set GCP_PROJECT_ID --body "your-gcp-project-id"
```

This is used by CI workflows to deploy to GKE.

## Step 3: Deploy Infrastructure

Bootstrapping is two applies, because `lore-db` reads the database password out
of Secret Manager at plan time — the container has to exist and hold a value
before the full apply can resolve it.

```bash
cd infra/terraform
terraform init

# 1. Create the (empty) secret containers.
terraform apply -target=google_secret_manager_secret.lore

# 2. Seed them. Idempotent — prompts only for the ones with no value yet.
../../scripts/infra/seed-secrets.sh

# 3. Everything else.
terraform apply
```

All the URL and hostname variables come from `terraform.tfvars`, which Terraform
loads automatically. On later runs only step 3 is needed.

Every hostname variable defaults to empty, which disables the matching ingress — so
omitting `lore_event_router_hostname` silently leaves GitHub with nowhere to deliver.
`lore_mcp_url` is what gives agent pods a live MCP endpoint; without it their recipes
ship without one.

This creates:
- GCP Secret Manager entries (14 secrets: 13 named values plus the GHCR pull secret)
- External Secrets Operator (syncs secrets to K8s)
- GCS bucket for task logs (CMEK encrypted, 30-day retention)
- KMS key ring + crypto key
- The namespaces, ExternalSecrets, ingresses, the CloudNativePG cluster CR, and the Dgraph StatefulSet
- **One Helm release, `lore_platform`** — the umbrella chart, whose nine vendored
  subcharts span a namespace each: Floor (`lore-floor`), event-router
  (`lore-event-router`), cluster-agent (`lore-cluster-agent`), Lore API (`lore-api`),
  the lore-mcp gateway (also `lore-api`), the stations service (`lore-stations`),
  Web UI (`lore-ui`), lore-db (`lore-db`), and the ai-agent-subsystem — the
  `Agent` / `Station` / `AgentDefinition` CRDs plus agent-controller (`ai-agents`)
- ConfigMaps for task-types.yaml

## Step 4: Set Up Database

```bash
scripts/infra/setup-db.sh
scripts/infra/setup-pipeline-schema.sh
```

These create the baseline schema once. Incremental, deploy-time schema changes
live in `infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/*.sql` and are applied
automatically on every UI deploy by a `pre-install,pre-upgrade` hook Job (see
that chart's `migrations/README.md`) — no manual `kubectl exec` needed for those.

## Step 5: Configure Webhooks

Webhooks are normally managed for you — the Lore API's `POST /api/repos/:owner/:repo/webhook/ensure`
creates or re-points a repo's hook at the canonical `LORE_WEBHOOK_URL`, and onboarding
calls it. Do it by hand only when the App lacks the permission:

```bash
gh api repos/OWNER/REPO/hooks --method POST --input - <<EOF
{
  "name": "web",
  "active": true,
  "events": ["issues", "pull_request", "pull_request_review", "issue_comment"],
  "config": {
    "url": "https://lore-events.example.com/api/events",
    "content_type": "json",
    "secret": "YOUR_WEBHOOK_SECRET"
  }
}
EOF
```

The delivery target is the **event-router**, the only writer of `pipeline.events`
([ADR-044](../adrs/ADR-044-event-router-owns-the-event-bus.md)); it recognises GitHub by
the `X-Hub-Signature-256` header and verifies the HMAC over the raw body, so the `secret`
must match the `lore-webhook-secret` value in Secret Manager or every delivery is refused. Existing
installs may still point at the Floor's `/api/webhook/github` on `lore_webhook_hostname`;
that route still works and reports through the router, and it is retired only once the
repos are re-pointed.

## Step 6: Install on a Developer Laptop

This is the per-developer install — it builds and registers the Lore MCP server
locally so Claude Code gets org context in every onboarded repo. No GKE access
needed; the local server proxies to the backend deployed above.

**Runs on macOS and Linux** (the installer is `#!/usr/bin/env bash` and stays
within bash 3.2, the macOS default).

**Prerequisites:**

- git
- Node.js >= 18 and npm (`uuidgen` or `python3` for the agent ID — one is present on both OSes)
- [Claude Code](https://claude.com/claude-code) (`claude` CLI) — the installer registers the MCP server through it
- A reachable Lore backend URL (the `lore_api_url` from Step 3). The local server
  has no offline mode; context, memory, and pipeline calls all proxy to it.

**Install:**

```bash
git clone https://github.com/re-cinq/lore.git
cd lore && scripts/install.sh
```

`scripts/install.sh` is idempotent — safe to re-run after a `git pull`. It:

- clones/updates the context checkout into `~/.re-cinq/lore`
- runs `npm ci` once at the repo root (npm workspaces) and builds
  `@re-cinq/lore-shared` + `@re-cinq/lore-mcp`
- registers the `lore-context` MCP server with Claude Code, pointing at
  `~/.re-cinq/lore/apps/mcp-server/dist/index.js`
- installs the platform skills, hooks, and system prompt
- generates a stable agent ID at `~/.lore/agent-id`
- runs `scripts/lore-doctor.sh` to verify the install

**Point it at your backend.** The installer reads these from global git config; set
them before (or after) running it:

```bash
git config --global lore.api-url     "https://lore-api.example.com"
git config --global lore.ingest-token "<your-token>"   # optional — needed to delegate tasks
```

**Where to get these values** — they belong to your team's deployed (remote) Lore
instance, not something you generate locally:

- **`lore.api-url`** — the external MCP API URL. Find it on the Lore web UI settings
  page, or ask the platform team.
- **`lore.ingest-token`** — the shared API token. Grab it from the same web UI settings
  page (it has a "Regenerate Token" button), or ask the platform team. With cluster
  access: `kubectl get secret lore-ingest-token -n lore-api -o jsonpath='{.data.token}' | base64 -d`.

If you run the **whole stack locally** instead (next section), these are set for you
(`http://localhost:3001` and a fixed dev token), so you can skip this step.

The token is also prompted for interactively on first install. Re-run
`scripts/install.sh` (or `scripts/lore-doctor.sh`) to confirm everything is green.

> **Want the whole stack on your laptop instead?** `npm start` from the repo root
> brings up Docker Postgres + Dgraph and runs the web-ui, mcp-server, and agent locally
> with live reload — no remote backend or platform config vars needed. To sign into the
> web UI you'll create a one-time GitHub OAuth app; full steps in
> [Run the full stack locally](building-lore/contributing.md#run-the-full-stack-locally).

## Step 7: Onboard Repos

**Via UI:** Go to `https://your-lore-instance.example.com/onboard`

**Via CLI:** `claude "onboard your-org/your-repo to lore"`

## Verify

```bash
# Check deployments across every namespace the umbrella spans
kubectl get deployments -A | grep -E 'lore-|ai-agents'

# Or one namespace at a time (kubectl takes a single -n)
for ns in lore-floor lore-api lore-ui lore-db lore-event-router \
          lore-stations lore-cluster-agent ai-agents; do
  echo "== $ns"; kubectl get deployments -n "$ns"
done

# Check CRDs (ai-agent-subsystem)
kubectl get crd agents.agents.re-cinq.com stations.agents.re-cinq.com agentdefinitions.agents.re-cinq.com

# Check logs bucket
gcloud storage ls gs://lore-task-logs-YOUR_PROJECT_ID/

# Create a test issue with the "lore" label on an onboarded repo
```

## Upgrading

```bash
git pull && cd infra/terraform && terraform apply
```

CI automatically builds and deploys on push to main.

## Disaster Recovery

```bash
cd infra/terraform && terraform destroy && terraform apply
```

`terraform destroy` will refuse while the secret containers carry
`prevent_destroy` — deliberately, since destroying them takes every historical
version of every live credential with them. If you genuinely mean to tear down
the secrets too, drop the `lifecycle` block in
[`secrets.tf`](../infra/terraform/secrets.tf) first, as a separate reviewed
commit. Otherwise `-target` the rest of the stack and leave the secrets standing;
a rebuilt platform re-attaches to them with no re-seeding.

All state is in Terraform. Secrets are in GCP Secret Manager. Task history is in PostgreSQL (back up separately).
