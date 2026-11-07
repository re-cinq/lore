# Deploying Lore

Lore runs on the GKE Autopilot cluster `internal-cluster` in the GCP project
`re-cinq-internal`, deployed by Argo CD. Nothing in this repository or its CI
talks to the cluster: a release is a merge to `main`, and the cluster pulls it.

## What Argo CD watches

Argo CD is installed by re-cinq/infrastructure (`docs/deploying.md` there). Its
ApplicationSet scans every repository of the re-cinq GitHub organisation and
deploys the ones that have both

- `deploy/chart/Chart.yaml`, the Helm chart, and
- `deploy/clusters/internal-cluster.values.yaml`, the values for this cluster.

The Argo application and its home namespace are named after the repository,
lowercased: `lore`. The chart's own templates stamp the namespaces its objects
land in (`lore-api`, `lore-ui`, `lore-db`, `lore-stations`, `lore-dgraph`,
`lore-floor`). Sync is automated with prune and self-heal: an object edited or
deleted by hand on the cluster is put back within minutes. A manual
`helm upgrade` against the cluster is wrong for the same reason, and Argo does
not run `helm install`, so `helm list` shows nothing there.

UI: https://argocd.gcp.re-cinq.com (Google sign-in, re-cinq.com accounts).

`deploy/chart/` is the umbrella chart: the service subcharts under
`chart/charts/` (lore-api, lore-mcp-gateway, lore-ui, lore-stations, lore-db
add-ons) plus the platform objects they need as templates: namespaces,
ExternalSecrets, ingresses, the `lore-db` CloudNativePG cluster with its
backups, Dgraph, and the monitoring objects. [`chart/README.md`](chart/README.md)
describes the chart itself.

## How a release happens

1. A pull request merges to `main`.
2. The build workflows (`.github/workflows/build-*.yml`) build the changed
   service images, push them to `ghcr.io` tagged with the short SHA, and
   commit the new tag into `deploy/clusters/internal-cluster.values.yaml`
   with `scripts/ci/bump-image-tag.sh` (one commit per image; the script
   rebases and retries when a sibling build got there first).
3. Argo CD notices the new commit on `main` and syncs. Helm hooks
   (`pre-install,pre-upgrade`) run as Argo PreSync hooks first: the lore-db
   ownership reconciler (`lore-db-helm.ownershipReconciler.enabled`), then
   the ui migrate ConfigMap and Job (`lore-ui.migrations.enabled`), which
   applies `deploy/chart/charts/ui-helm/migrations/*.sql` not yet recorded in
   `lore.schema_migrations`. Both are on; they were switched off only for the
   first sync of the move to this cluster.

A change that is not an image (an env var, a hostname, a resource request, a
new ExternalSecret) is an edit to the values file or the chart, merged like
any other PR. Argo deploys it the same way.

Render what Argo will apply before merging:

```sh
helm template lore deploy/chart -f deploy/clusters/internal-cluster.values.yaml
helm lint deploy/chart
```

## How to add a secret

Secret values live in Secret Manager in `re-cinq-internal` and nowhere in git.

1. Declare the container in re-cinq/infrastructure,
   `projects/internal/secrets.tf`; merge and apply.
2. Add the value:
   `printf '%s' "$VALUE" | gcloud secrets versions add <name> --project=re-cinq-internal --data-file=-`.
3. Map it under `platform.externalSecrets` in the values file (Kubernetes
   Secret name, namespace, and `keys` from Secret key to Secret Manager name),
   and reference it from the service's `secretKeyRef` in the same PR. The
   chart renders an `ExternalSecret` (`external-secrets.io/v1beta1`) that reads
   it through `ClusterSecretStore/gcp-secret-manager`.

A secret not yet copied from the old project can set its store to
`gcp-secret-manager-legacy`; that store goes away with the old project, so copy
the value instead of relying on it. Rotation, restart sets and the Gemini,
Utopia and lore-reviewer credentials:
[`docs/managing-secrets.md`](../docs/managing-secrets.md).

## How to check a rollout

In the Argo CD UI open the `lore` application: Sync Status should be Synced
and Health Healthy, and the resource tree shows which object is still
progressing or degraded, with its events and logs. From a terminal:

```sh
gcloud container clusters get-credentials internal-cluster --region europe-west1 --project re-cinq-internal
kubectl -n argocd get application lore
kubectl -n lore-api rollout status deployment/lore-api
kubectl -n lore-ui rollout status deployment/lore-ui
kubectl -n lore-stations rollout status deployment/lore-stations
kubectl -n lore-api get deployment lore-api -o jsonpath='{.spec.template.spec.containers[0].image}'
```

The last line prints the running image; it should match the tag in the values
file.

Metrics and dashboards are cluster-wide (Prometheus, Grafana and Headlamp are
installed by re-cinq/infrastructure). Lore declares what it wants scraped and
shown in `deploy/chart/templates/monitoring.yaml`: ServiceMonitors and the
dashboard ConfigMaps rendered from `deploy/chart/files/dashboards/*.json`,
toggled by `platform.monitoring.enabled`. Grafana:
https://grafana.gcp.re-cinq.com. Headlamp (read-only view of the cluster):
https://headlamp.gcp.re-cinq.com. Both use Google sign-in.

## How to roll back

Revert the commit that bumped the image tag in
`deploy/clusters/internal-cluster.values.yaml` (or the chart change) and
merge; Argo syncs the previous state. Reverting the code commit alone is not a
rollback until its build has bumped the tag again. The Argo UI's History and
rollback can re-sync an earlier revision as a stopgap, but automated sync
returns to whatever `main` says, so land the revert.

`helm rollback` does not apply: there is no Helm release on the cluster.

## When a sync is stuck

Most stuck syncs are a failed PreSync hook: the migrate Job or the ownership
reconciler exited non-zero, and Argo keeps the sync in Progressing or Failed
with the hook's Job in the tree.

1. Read the hook's logs in the Argo UI, or with
   `kubectl -n lore-ui logs job/<migrate job>` and
   `kubectl -n lore-db logs job/<reconciler job>`.
2. Fix the cause (usually a migration) in a PR. The hooks are idempotent and
   use `hook-delete-policy: before-hook-creation`, so the next sync re-runs
   them cleanly.
3. If Argo is wedged on the old attempt, Terminate the sync in the UI and
   Sync again, or
   `kubectl -n argocd patch application lore --type merge -p '{"operation":null}'`
   and let automated sync retry.

An ExternalSecret that cannot find its Secret Manager version leaves the new
pod in `CreateContainerConfigError` while the old pod keeps serving;
`kubectl -n <ns> describe externalsecret <name>` says which key is missing.

## What is not here

Google Cloud resources (service accounts, buckets, Secret Manager containers,
the BigQuery billing export) and the cluster baseline the chart assumes
(External Secrets Operator and its ClusterSecretStores, the CloudNativePG
operator, cert-manager, ingress, Prometheus, Grafana, Headlamp, Argo CD) are in
re-cinq/infrastructure (`projects/internal`). This repository carries no
Terraform since #4197: lore is a Helm chart only.
