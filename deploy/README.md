# deploy/

The Lore platform as one Helm chart, and one values file per cluster.

`chart/` is the umbrella: the five application subcharts under `chart/charts/` (lore-api, lore-mcp-gateway, lore-ui, lore-stations, the lore-db add-on) plus the platform objects they need, as templates: namespaces, ExternalSecrets, ingresses, the lore-db CNPG cluster with its backups, and Dgraph. `clusters/<name>.values.yaml` is what Argo CD on that cluster deploys on every merge to `main`. The convention is described in re-cinq/infrastructure, `docs/deploying.md`.

A new image lands when a build workflow commits its tag into the cluster's values file (`scripts/ci/bump-image-tag.sh`). Nothing in CI talks to the cluster.

Render locally:

```sh
helm template lore deploy/chart -f deploy/clusters/n8n-cluster.values.yaml
```

Secret values never live here. Every entry under `platform.externalSecrets` names a Secret Manager key; the cluster's External Secrets Operator fills the Kubernetes Secret.

## Moving from Terraform to Argo CD

Until the cutover, `infra/terraform` still applies the umbrella and owns the platform objects. The chart renders the same objects with the same names, so Argo adopts them in place. The order:

1. Merge this chart. Terraform keeps working; it now reads the chart from `deploy/chart`.
2. Argo CD on `n8n-cluster` picks the repo up (needs `deploy/clusters/n8n-cluster.values.yaml`, present) and creates the `lore` application. Check it is Healthy and Synced in the Argo UI. Objects it adopts get an `argocd.argoproj.io/tracking-id` annotation and nothing else changes.
3. Release the Kubernetes objects from Terraform state so a later `terraform apply` neither fights Argo nor deletes them:
   ```sh
   cd infra/terraform
   terraform state list | grep -E '^(kubectl_manifest|kubernetes_|helm_release\.lore_platform)' \
     | grep -vE 'headlamp|monitoring|grafana|kube_prometheus|cluster_secret_store|external_secrets|eso' \
     | xargs -n1 terraform state rm
   ```
   Then delete the matching resources from `*.tf` (`lore-platform.tf`, `lore-api.tf`, `lore-ui.tf`, `lore-mcp.tf`, `lore-floor.tf`, `lore-db.tf` Kubernetes parts, `lore-dgraph.tf`, `external-secrets.tf` platform entries, `utopia.tf`) and confirm `terraform plan` shows no changes. GCP resources (service accounts, buckets, KMS, budgets, secret containers) stay in Terraform.
4. Delete `scripts/ci/deploy-lore-platform.sh` and `scripts/ci/helm-lock-contention.sh`; nothing calls them.

Utopia moved out of this repository: its chart is in re-cinq/utopia under `deploy/`. The `utopia.tf` resources are released in step 3 the same way.

Headlamp, Grafana and the monitoring stack are cluster baseline, not Lore; they stay in Terraform until re-cinq/infrastructure takes them.
