# lore-platform — the platform umbrella chart

One Helm chart for the whole Lore platform. It vendors the five service charts
as subcharts under `charts/`:

| Subchart (value key) | Namespace    | Workload |
|----------------------|--------------|----------|
| `lore-floor`         | `lore-floor` | Floor coordinator + 11 cron jobs |
| `lore-mcp`           | `mcp-servers`| MCP context server |
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
- **CI** (`.github/workflows/build-{floor,mcp,ui}.yml`) bumps a single
  service's image per push:

  ```
  helm upgrade --install lore-platform <this chart> \
    --namespace lore-floor \
    --set <subchart>.image.tag=<git-sha> \
    --reset-then-reuse-values --cleanup-on-fail
  ```

  `--reset-then-reuse-values` keeps the other subcharts' tags and the
  Terraform-supplied config intact. The three deploy jobs share a GitHub Actions
  `concurrency` group (`helm-lore-platform-deploy`) so they never run two helm
  upgrades against the release at once.

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
