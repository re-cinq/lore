# lore-platform — the platform umbrella chart

One Helm chart for the whole Lore platform. It vendors the five service charts
as subcharts under `charts/`:

| Subchart (value key) | Namespace    | Workload |
|----------------------|--------------|----------|
| `lore-floor`         | `lore-floor` | Floor coordinator + 8 cron jobs |
| `lore-api`           | `lore-api`   | Lore REST API server |
| `lore-ui`            | `lore-ui`    | Next.js web UI (+ DB migrate hook) |
| `lore-db-helm`       | `lore-db`    | CNPG ownership-reconciler hook |
| `ai-agents`          | `ai-agents`  | agent-cr controller + CRDs + RBAC |

## One release, many namespaces

This is a single Helm release (`lore-platform`, recorded in the `lore-floor`
home namespace), but its resources land in five namespaces. Each subchart
template sets `metadata.namespace: {{ .Values.namespace }}` explicitly (instead
of relying on `.Release.Namespace`) and pins resource names to `.Chart.Name`
(instead of `.Release.Name`). Without that, every resource would inherit the
parent release name/namespace and collide. The per-subchart `namespace` default
lives in each subchart's `values.yaml`; the parent `values.yaml` restates them.

Subcharts are **vendored** (physically under `charts/`), so no
`helm dependency build`/`update` step is needed — `helm template`/`install`
work as-is.

## Deploy contract: Terraform owns config, CI owns image tags

- **Terraform** (`infra/terraform/lore-platform.tf`) owns the one
  `helm_release.lore_platform` with all env/secret config via a nested `values`
  block, and `reuse_values = true` so a `terraform apply` merges config on top
  of the live release **without** resetting image tags.
- **CI** (`.github/workflows/build-{floor,lore-api,ui}.yml`) bumps a single
  service's image per push, each through `scripts/ci/deploy-lore-platform.sh`:

  ```
  helm upgrade --install lore-platform <this chart> \
    --namespace lore-floor \
    --set-string <subchart>.image.tag=<git-sha> \
    --reset-then-reuse-values --cleanup-on-fail
  ```

  `--reset-then-reuse-values` keeps the other subcharts' tags and the
  Terraform-supplied config intact (`--set-string`, never `--set`, so an
  all-digits short SHA is not coerced to a float and re-rendered as
  `InvalidImageName` on the next reuse). Several build workflows can fire at
  once (a `libs/shared` change rebuilds floor + lore-api), so instead of a
  GitHub `concurrency` group — which keeps only one pending run and cancels the
  rest — the deploy script serializes on Helm's own release lock: it retries
  while another deploy holds the lock and clears only a stale (>5 min) leftover
  from a dead run.

Not deployed by this chart (stays Terraform-owned): the GKE cluster, the
namespaces, ESO + ExternalSecrets, the two ingresses, the CNPG cluster CR, and
the Dgraph StatefulSet.

## Hook ordering

Pre-install/pre-upgrade hooks run on **every** umbrella upgrade (they are
release-scoped). Weights order them: lore-db ownership-reconciler (`-10`) →
ui migrate ConfigMap (`-5`) → ui migrate Job (`0`). All hooks are idempotent,
so they no-op when re-run by an unrelated (e.g. floor) deploy.

## Render locally

```
helm template lore-platform . --include-crds --namespace lore-floor
helm lint .
```
