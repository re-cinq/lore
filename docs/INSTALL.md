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

# Copy example and fill in your values
cp infra/terraform/secrets.tfvars.example infra/terraform/secrets.tfvars
```

Required variables in `secrets.tfvars`:

| Variable | Description |
|----------|-------------|
| `github_app_id` | GitHub App ID |
| `github_app_private_key` | GitHub App private key (PEM) |
| `github_app_installation_id` | GitHub App installation ID |
| `anthropic_api_key` | Anthropic API key for Claude |
| `db_password` | PostgreSQL password |
| `ingest_token` | Shared token for API auth |
| `github_oauth_client_id` | GitHub OAuth App client ID (for UI login) |
| `github_oauth_client_secret` | GitHub OAuth App client secret |
| `nextauth_secret` | Random string for NextAuth session encryption |
| `ghcr_pull_secret_dockerconfigjson` | Base64-encoded `.dockerconfigjson` for GHCR |

## Step 2: Set GitHub Actions Variable

```bash
gh variable set GCP_PROJECT_ID --body "your-gcp-project-id"
```

This is used by CI workflows to deploy to GKE.

## Step 3: Deploy Infrastructure

```bash
cd infra/terraform
terraform init
terraform apply \
  -var-file=secrets.tfvars \
  -var='lore_api_url=https://lore-api.example.com' \
  -var='lore_ui_url=https://lore.example.com' \
  -var='lore_ui_hostname=lore.example.com' \
  -var='github_org=your-github-org'
```

This creates:
- GCP Secret Manager entries (11 secrets)
- External Secrets Operator (syncs secrets to K8s)
- GCS bucket for task logs (CMEK encrypted, 30-day retention)
- KMS key ring + crypto key
- Helm releases: Floor, MCP Server
- LoreTask CRD + controller deployment
- Web UI deployment + ingress
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

For each repo you want to use with GitHub Issue dispatch:

```bash
gh api repos/OWNER/REPO/hooks --method POST --input - <<EOF
{
  "name": "web",
  "active": true,
  "events": ["issues"],
  "config": {
    "url": "https://your-lore-api.example.com/api/webhook/github",
    "content_type": "json"
  }
}
EOF
```

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
git clone https://github.com/your-org/lore.git
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
# Check deployments
kubectl get deployments -A | grep lore

# Check CRD
kubectl get crd loretasks.lore.re-cinq.com

# Check logs bucket
gcloud storage ls gs://lore-task-logs-YOUR_PROJECT_ID/

# Create a test issue with the "lore" label on an onboarded repo
```

## Upgrading

```bash
git pull && cd infra/terraform && terraform apply -var-file=secrets.tfvars
```

CI automatically builds and deploys on push to main.

## Disaster Recovery

```bash
cd infra/terraform && terraform destroy && terraform apply -var-file=secrets.tfvars
```

All state is in Terraform. Secrets are in GCP Secret Manager. Task history is in PostgreSQL (back up separately).
