# lore-platform — the platform umbrella chart

One Helm chart for the whole Lore platform. It vendors the five service charts
as subcharts under `charts/`:

| Subchart (value key) | Namespace    | Workload |
|----------------------|--------------|----------|
| `lore-api`           | `lore-api`   | Lore REST API server |
| `lore-ui`            | `lore-ui`    | Next.js web UI (+ DB migrate hook) |
| `lore-db-helm`       | `lore-db`    | CNPG ownership-reconciler hook |
| `lore-mcp-gateway`   | `lore-api`   | lore-mcp HTTP gateway for agent pods |
| `lore-stations`      | `lore-stations` | stations service (sweeps, event drain, floor stations) |

## One release, many namespaces

Argo CD renders this chart as one release named `lore` in the application's
home namespace `lore`, but its resources land in four namespaces. Each subchart
template sets `metadata.namespace: {{ .Values.namespace }}` explicitly (instead
of relying on `.Release.Namespace`) and pins resource names to `.Chart.Name`
(instead of `.Release.Name`). Without that, every resource would inherit the
parent release name/namespace and collide. The per-subchart `namespace` default
lives in each subchart's `values.yaml`; the parent `values.yaml` restates them.

Subcharts are **vendored** (physically under `charts/`), so no
`helm dependency build`/`update` step is needed — `helm template`/`install`
work as-is.

## Deploy contract: the values file owns config, CI owns image tags

- **Argo CD** on re:cinq's internal cluster (re-cinq/infrastructure,
  docs/deploying.md; [../README.md](../README.md)) installs this chart with
  `deploy/clusters/internal-cluster.values.yaml`: every env, secret name and
  hostname lives there and changes by PR.
- **CI** (`.github/workflows/build-{lore-api,mcp-server,stations,ui}.yml`)
  records each freshly built image's short SHA in that same values file
  through `scripts/ci/bump-image-tag.sh` and pushes the commit to `main`;
  Argo CD rolls it out. Several builds from one push each land their own
  commit; the script rebases and retries when a sibling got there first.

Not deployed by this chart: the GKE cluster and its baseline (ingress
controller, cert-manager, External Secrets, CloudNativePG), which
re-cinq/infrastructure owns. The namespaces, ExternalSecrets, ingresses, the
CNPG cluster and the Dgraph StatefulSet ship here.

## Hook ordering

Pre-install/pre-upgrade hooks run as Argo CD PreSync hooks on **every** sync
(they are release-scoped). Weights order them: lore-db ownership-reconciler (`-10`) →
ui migrate ConfigMap (`-5`) → ui migrate Job (`0`). All hooks are idempotent,
so they no-op when re-run by an unrelated (e.g. floor) deploy.

## Render locally

```
helm template lore . --include-crds --namespace lore -f ../clusters/internal-cluster.values.yaml
helm lint .
```
