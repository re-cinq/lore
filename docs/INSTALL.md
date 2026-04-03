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
cp terraform/secrets.tfvars.example terraform/secrets.tfvars
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
cd terraform
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
- Helm releases: Lore Agent, MCP Server
- LoreTask CRD + controller deployment
- Web UI deployment + ingress
- ConfigMaps for task-types.yaml

## Step 4: Set Up Database

```bash
scripts/infra/setup-db.sh
scripts/infra/setup-pipeline-schema.sh
```

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

## Step 6: Install for Developers

Each developer runs:

```bash
git clone https://github.com/your-org/lore.git
cd lore && scripts/install.sh
```

This configures the MCP server locally. No infrastructure needed for context retrieval.

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
git pull && cd terraform && terraform apply -var-file=secrets.tfvars
```

CI automatically builds and deploys on push to main.

## Disaster Recovery

```bash
terraform destroy && terraform apply -var-file=secrets.tfvars
```

All state is in Terraform. Secrets are in GCP Secret Manager. Task history is in PostgreSQL (back up separately).
