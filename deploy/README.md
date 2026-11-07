# deploy/

The Lore platform as one Helm chart, and one values file per cluster.

`chart/` is the umbrella: the five application subcharts under `chart/charts/` (lore-api, lore-mcp-gateway, lore-ui, lore-stations, the lore-db add-on) plus the platform objects they need, as templates: namespaces, ExternalSecrets, ingresses, the lore-db CNPG cluster with its backups, and Dgraph. `clusters/<name>.values.yaml` is what Argo CD on that cluster deploys on every merge to `main`. The convention is described in re-cinq/infrastructure, `docs/deploying.md`.

A new image lands when a build workflow commits its tag into the cluster's values file (`scripts/ci/bump-image-tag.sh`). Nothing in CI talks to the cluster.

Render locally:

```sh
helm template lore deploy/chart -f deploy/clusters/internal-cluster.values.yaml
```

Secret values never live here. Every entry under `platform.externalSecrets` names a Secret Manager key; the cluster's External Secrets Operator fills the Kubernetes Secret.

Google Cloud resources (service accounts, buckets, Secret Manager containers) and the cluster addons the chart relies on (External Secrets Operator and its `ClusterSecretStore`, the CloudNativePG operator, cert-manager, ingress, monitoring) are in re-cinq/infrastructure.
