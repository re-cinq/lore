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

One ingress shares a hostname: `lore-ui-live` sends `lore.gcp.re-cinq.com/api/ws`
(the live socket, ADR-048) to lore-api, while every other path of that host stays
with the UI, so the session cookie rides the socket's upgrade.

## How a release happens

1. A pull request merges to `main`.
2. The build workflows (`.github/workflows/build-*.yml`) build the changed
   service images, push them to `ghcr.io` tagged with the short SHA, and
   commit the new tag into `deploy/clusters/internal-cluster.values.yaml`
   with `scripts/ci/bump-image-tag.sh` (one commit per image; the script
   rebases and retries when a sibling build got there first). The four
   service images are built under private names,
   `ghcr.io/re-cinq/lore-security-{api,mcp,ui,stations}`, because this
   repository holds work that is not released yet; the public
   `ghcr.io/re-cinq/lore-{api,mcp,ui,stations}` images get a build only when it
   is released (below). The agent image, which holds the tools an agent pod
   runs and none of this repository's source, keeps its public name
   `ghcr.io/re-cinq/lore-agent`.
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

## Releasing Lore

A release is a git tag `vX.Y.Z` on a commit of `main`. The tag gives every Lore
image that version, and publishes the install chart (`deploy/install`) with the
Lore, floor and Utopia charts inside, as `oci://ghcr.io/re-cinq/charts/lore-install`
at the version without the `v`. No image is rebuilt: the tag is added to the
images our own cluster runs, as recorded in
`deploy/clusters/internal-cluster.values.yaml`, and for a service image it is
added on the public image: the private build our cluster runs is copied to
`ghcr.io/re-cinq/<image>:vX.Y.Z` with the same digest. No commit carries the version:
`scripts/ci/package-install-chart.sh` stamps it into the image tags of the
staged copy of `deploy/install/values.yaml`, so the committed file and the
install guide name no release.

1. Wait until the `deploy(...)` pull requests of the build workflows for the
   commits you want have merged to `main`. Those values are what gets released.
2. Tag the commit and push the tag:
   `git tag vX.Y.Z <commit of main> && git push origin vX.Y.Z`.
3. `.github/workflows/release.yml` checks the tag, runs
   `scripts/ci/release-images.sh`, verifies the digests, packages the install
   chart, checks that the archive pins every image to the version
   (`scripts/ci/check-install-pins.sh`), pushes it, and completes the GitHub
   release: it appends the chart address and the image table to the release of
   that tag if one exists, and creates the release otherwise. Utopia's chart
   comes from the git tag `v<utopia.image.tag>` of re-cinq/utopia, so that tag
   must exist, and the floor chart version in `deploy/install/Chart.yaml` must
   be published.

To check the packaging before tagging, run
`bash scripts/ci/package-install-chart.sh v0.0.0 /tmp/chart` and then
`bash scripts/ci/check-install-pins.sh v0.0.0 /tmp/chart/lore-install-0.0.0.tgz`
(the pull request check of the install chart does both). To see what a
release would tag, run
`bash scripts/ci/release-images.sh vX.Y.Z --dry-run` from the commit.

When it fails: a check that fails before any image is tagged (bad tag, commit
not on `main`) is fixed by deleting the tag
(`git push origin :refs/tags/vX.Y.Z`), fixing the cause and tagging again. A
version tag already on an image with another digest is an error on purpose, as
a version is never moved: pick the next version instead. A permission error
means a package does not give this repository the access the copy needs: read
on the private `lore-security-*` packages and write on the public `lore-*`
ones (package settings, "Manage Actions access"). If only the release step failed, run the workflow
again from the Actions tab, the image step is a no-op the second time.

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

## What only our own cluster has

The install tutorials ([`docs/install`](../docs/install/README.md)) are for a cluster we do not run. What follows is ours.

The floor and the agent subsystem are separate Argo CD applications here, in the namespaces `floor` and `ai-agents`, installed as [floor/docs/install.md](https://github.com/re-cinq/floor/blob/main/docs/install.md) describes. The `deploy/install` chart is not used. The Secrets that chart writes from its values are mirrored here by External Secrets (`platform.externalSecrets` in the values file, rendered by `chart/templates/externalsecrets.yaml`). Their Secret Manager names:

| Secret Manager name | Kubernetes Secret |
| ------------------- | ----------------- |
| `lore-db-password` | `lore-api-db-password`, `lore-db-password` (lore-ui), `lore-stations-db-password` |
| `lore-ingest-token`, `lore-agent-internal-token` | the Secrets of the same names, in `lore-api` and `lore-stations` |
| `lore-github-app-*` | `github-app-credentials`, `lore-stations-github-app` |
| `lore-webhook-secret`, `lore-github-oauth-*` | `lore-webhook-secret`, `lore-github-oauth` |
| `lore-anthropic-api-key`, `lore-gemini-api-key` | `lore-anthropic-key`, `lore-stations-anthropic-key`, and the Gemini key |
| `lore-floor-service-token`, `lore-floor-git-credential-token` | `floor-service-token`, `floor-git-credential-token` |
| `lore-slack-*` | `lore-slack-credentials`, `lore-stations-slack` |
| `lore-ghcr-pull-secret` | `ghcr-pull-secret` for the images that are not public on this cluster |

Disaster recovery: the cluster's add-ons and cloud resources come back from re-cinq/infrastructure and Argo CD syncs the chart again. The Secret Manager containers keep their versions, so a rebuilt platform attaches to them with no re-seeding. Everything else is in the two Postgres databases and Dgraph, so back those up.

lore-api's Cloud Trace exporter has no `roles/cloudtrace.agent` grant here, so traces are off ([#3905](https://github.com/re-cinq/lore/issues/3905)).

## What is not here

Google Cloud resources (service accounts, buckets, Secret Manager containers,
the BigQuery billing export) and the cluster baseline the chart assumes
(External Secrets Operator and its ClusterSecretStores, the CloudNativePG
operator, cert-manager, ingress, Prometheus, Grafana, Headlamp, Argo CD) are in
re-cinq/infrastructure (`projects/internal`). This repository carries no
Terraform since #4197: lore is a Helm chart only.
