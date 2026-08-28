# Feature Specification: External Secrets + Terraform GitOps

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | ESO + Terraform GitOps                   |
| Branch         | feat/eso-gitops                          |
| Status         | Draft                                    |
| Created        | 2026-04-02                               |
| Owner          | Platform Engineering                     |
| Target         | 1 week                                   |

ESO + Terraform GitOps consolidates Lore's scattered deployment state — manually created K8s Secrets, ad-hoc kubectl patches, duplicated credentials — into GCP Secret Manager fronted by External Secrets Operator and Terraform, so the whole platform can be reconstructed from scratch with a single command.

## Problem Statement

Lore's deployment state is scattered:
- 8 K8s Secrets created manually across 4 namespaces
- Env vars added via ad-hoc `kubectl patch` (some literal, some secretRef)
- Helm values reference hardcoded secret names
- No single command to spin up Lore from scratch
- Secret rotation requires manual kubectl in each namespace
- Secrets duplicated across namespaces (github-app-credentials in 3 places)

If the cluster dies, reconstructing Lore requires reading this
conversation history.

## Solution: ESO + GCP Secret Manager + Terraform

### Secret Inventory

All secrets consolidated into GCP Secret Manager:

| GCP Secret | Used By | K8s Secret(s) Created |
|------------|---------|----------------------|
| `lore-github-app-id` | agent, mcp, controller, ui | `github-app-credentials` |
| `lore-github-app-private-key` | agent, mcp, controller, ui | `github-app-credentials` |
| `lore-github-app-installation-id` | agent, mcp, controller, ui | `github-app-credentials` |
| `lore-anthropic-api-key` | agent, controller | `lore-anthropic-key` |
| `lore-db-password` | agent, mcp, ui | `lore-db-password` |
| `lore-ingest-token` | agent, mcp | `lore-ingest-token` |
| `lore-webhook-secret` | mcp | `lore-webhook-secret` |
| `lore-github-oauth-client-id` | ui | `lore-ui-oauth` |
| `lore-github-oauth-client-secret` | ui | `lore-ui-oauth` |
| `lore-nextauth-secret` | ui | `lore-ui-oauth` |
| `lore-ghcr-pull-secret` | agent, mcp, ui | `ghcr-pull-secret` |

### Architecture

```
Terraform
├── google_secret_manager_secret (containers only — ADR-046)
│     (values are NOT Terraform-managed; see the amendment below)
├── helm_release: external-secrets (ESO operator)
├── kubectl_manifest: ClusterSecretStore (GCP provider)
├── kubectl_manifest: ExternalSecret per namespace (4)
├── helm_release: lore-mcp
├── helm_release: lore-agent
├── kubectl_manifest: LoreTask CRD + RBAC + controller
└── helm_release: lore-ui

ESO (in-cluster)
├── ClusterSecretStore → GCP Secret Manager (Workload Identity)
├── ExternalSecret (lore-agent ns) → K8s Secrets
│   ├── github-app-credentials (3 keys)
│   ├── lore-anthropic-key
│   ├── lore-db-password
│   ├── lore-ingest-token
│   └── ghcr-pull-secret
├── ExternalSecret (mcp-servers ns) → K8s Secrets
│   ├── github-app-credentials
│   ├── lore-db-password
│   ├── lore-ingest-token
│   ├── lore-webhook-secret
│   └── ghcr-pull-secret
├── ExternalSecret (lore-ui ns) → K8s Secrets
│   ├── github-app-credentials
│   ├── lore-db-password
│   ├── lore-ui-oauth (3 keys)
│   └── ghcr-pull-secret
└── Refresh: every 1h (auto-rotation)
```

### Terraform Structure

```
terraform/
├── main.tf                    # provider config, GKE data source
├── variables.tf               # project_id, region, cluster_name
├── secrets.tf                 # GCP Secret Manager resources
├── eso.tf                     # ESO helm release + ClusterSecretStore
├── external-secrets.tf        # ExternalSecret CRs per namespace
├── lore-crd.tf                # LoreTask CRD + RBAC + controller
├── lore-agent.tf              # Helm release for agent
├── lore-mcp.tf                # Helm release for MCP server
├── lore-ui.tf                 # Helm release for UI (or deployment)
├── configmaps.tf              # task-types.yaml ConfigMaps
└── outputs.tf                 # API URL, webhook URL
```

### Helm Values Changes

Remove all `secretKeyRef` from env blocks. Instead, reference
ESO-created secrets with consistent names:

```yaml
# Before (hardcoded secret names per chart)
env:
  - name: ANTHROPIC_API_KEY
    valueFrom:
      secretKeyRef:
        name: lore-agent-anthropic-key  # manually created
        key: anthropic-api-key

# After (ESO-managed, same name everywhere)
env:
  - name: ANTHROPIC_API_KEY
    valueFrom:
      secretKeyRef:
        name: lore-anthropic-key  # created by ExternalSecret
        key: api-key
```

### Workload Identity for ESO

ESO needs to read from GCP Secret Manager. Use Workload Identity:

```hcl
resource "google_service_account" "eso" {
  account_id   = "lore-eso"
  display_name = "Lore ESO"
}

resource "google_project_iam_member" "eso_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.eso.email}"
}

resource "google_service_account_iam_member" "eso_wi" {
  service_account_id = google_service_account.eso.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[external-secrets/external-secrets]"
}
```

### Bootstrap Flow

From zero to running Lore:

```bash
# 1. Set secret values (one-time, stored in GCP)
terraform apply

# 2. ESO syncs secrets to K8s (automatic)
# 3. Helm releases deploy all services (automatic)
# 4. LoreTask CRD applied (automatic)

# That's it. One command.
```

For Day 2 operations:
- Rotate a secret: update in GCP Secret Manager → ESO syncs within 1h
- Add a new service: add ExternalSecret + Helm release in Terraform
- Disaster recovery: `terraform apply` on a new cluster

### Migration Plan

1. Install ESO operator via Terraform
2. Create GCP secrets from current K8s secret values
3. Create ExternalSecrets pointing to GCP secrets
4. Verify ESO-created K8s secrets match current ones
5. Update Helm charts to reference new secret names
6. Remove manually created secrets
7. Test full deploy from scratch on a staging namespace

## File Changes

| File | Change |
|------|--------|
| `terraform/main.tf` | New: provider config, GKE data |
| `terraform/variables.tf` | New: project, region, cluster |
| `terraform/secrets.tf` | New: 11 GCP Secret Manager resources |
| `terraform/eso.tf` | New: ESO helm + ClusterSecretStore |
| `terraform/external-secrets.tf` | New: ExternalSecret CRs |
| `terraform/lore-agent.tf` | New: Helm release |
| `terraform/lore-mcp.tf` | New: Helm release |
| `terraform/lore-crd.tf` | New: CRD + RBAC + controller |
| `terraform/configmaps.tf` | New: task-types ConfigMaps |
| `terraform/modules/gke-mcp/*/values.yaml` | Update: reference ESO secret names |

## Amendment (2026-08-27) — Rationale: Terraform owns containers, not values

The architecture above placed both halves of a secret under Terraform —
`google_secret_manager_secret` for the name and
`google_secret_manager_secret_version` for the value, fed by `sensitive = true`
variables from the gitignored `infra/terraform/secrets.tfvars`. That satisfied
acceptance criterion 4 (no secret values in Git) and still produced a recurring
outage, because a gitignored per-laptop file is unshareable and therefore
divergent: the apply that reconciled two copies always won, and a stale checkout
would push an OLD value back up as a new version, ESO would sync it, and the
fleet would 401.

The version resources are removed. Terraform declares the containers and
resolves values by name; rotation is `gcloud secrets versions add` plus the
restart set. Full reasoning, the rejected alternatives, and the traps
(`moved` blocks on address changes, the two-apply bootstrap) are in
[ADR-046](../../adrs/ADR-046-secret-values-are-not-terraform-inputs.md);
the operational procedures are in
[docs/managing-secrets.md](../../docs/managing-secrets.md).

Two acceptance criteria below are superseded by this amendment:

- **AC 4** is strengthened rather than replaced. "No secret values in Git" was
  always true and was never sufficient — the file was outside Git and still
  functioned as a second source of truth. The binding criterion is now: *no
  secret value is a Terraform input, and `infra/terraform/variables.tf` contains
  no `sensitive = true` variable.*
- **AC 7** (`terraform destroy` + `terraform apply` fully recovers the platform)
  no longer holds. Secret containers carry `prevent_destroy`, because they hold
  every historical version of a live credential. A full teardown now means
  `-target`ing around them, or dropping the lifecycle block as a separate
  reviewed commit. Recovery *without* teardown is unaffected and is in fact
  better: a rebuilt platform re-attaches to the surviving secrets with no
  re-seeding.

This spec's `| Status |` row stays **Draft** despite the work being live, and
that is a known debt rather than an oversight: `lore/require-status-matches-coverage`
is an error, and flipping the row demands a `([validated by …])` link on all 33
of this spec's testable statements. That is the spec-to-shipped exercise, not a
line in an amendment — tracked separately.

Terraform no longer proves a secret has a value, so `scripts/infra/seed-secrets.sh`
(seeds a fresh environment, `--check` fails on an empty container) and
`scripts/infra/check-secrets.sh` (fails when a consuming pod predates the version
it should be holding) carry that guarantee instead.

## Out of Scope

1. **Database provisioning** — CloudNativePG stays manual (complex HA setup)
2. **DNS/Cert management** — external-dns + cert-manager stay as-is
3. **GitHub App creation** — manual (one-time setup, not automatable)
4. **ArgoCD/Flux** — Terraform is the GitOps tool, no CD operator

## Acceptance Criteria

1. `terraform apply` from scratch creates all secrets, deploys all services
2. All K8s secrets managed by ESO, none manually created
3. Secret rotation in GCP propagates to K8s within 1 hour
4. No secret values in Git (only GCP secret references)
5. Helm values don't contain hardcoded secret names
6. Existing services continue working during migration
7. `terraform destroy` + `terraform apply` fully recovers the platform
