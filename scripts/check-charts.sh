#!/usr/bin/env bash
# Lint and render every Helm chart. Nothing else in CI does this, so a broken
# template used to be caught at deploy time — or by whoever happened to run
# `helm template` by hand (#1372).
#
# `helm template` converts its output YAML→JSON, so it fails on a malformed
# render by itself; no extra parser is needed. What it cannot do on its own is
# exercise a template guarded by an empty list: the courier CronJob renders
# NOTHING under default values, so a defaults-only pass would have been green
# against the chomp bug that shipped `emptyDir: {}---`. Hence the fixtures.
#
# Run locally exactly as CI does: bash scripts/check-charts.sh
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
charts_dir="$root/deploy/chart/charts"
umbrella="$root/deploy/chart"
fixtures="$root/infra/chart-ci-values"
failed=0

say() { echo "[charts] $*"; }

# Fail closed on a moved or renamed tree. Without this the loop below iterates an
# unmatched glob, checks nothing, and prints "all charts lint and render" — the
# exact false green this script exists to prevent, in the script itself.
[[ -d "$charts_dir" ]] || { say "FAIL: charts dir not found: $charts_dir"; exit 1; }
[[ -d "$umbrella" ]] || { say "FAIL: umbrella not found: $umbrella"; exit 1; }

check() {
  local chart="$1" name deps_vendored=0
  name="$(basename "$chart")"

  # A chart with a file:// dependency needs it vendored to lint/render; the
  # tgz + Chart.lock are generated artifacts, so vendor here and clean up after.
  if grep -q "file://" "$chart/Chart.yaml" 2>/dev/null; then
    say "dependency update $name"
    helm dependency update "$chart" >/dev/null       || { say "FAIL dependency update $name"; failed=1; return; }
    deps_vendored=1
  fi

  say "lint $name"
  helm lint "$chart" >/dev/null || { say "FAIL lint $name"; failed=1; return; }

  # A fixture exists for charts whose templates are dormant under defaults.
  # With a fixture, the fixture is how CI renders the chart; without one,
  # plain defaults must render.
  local fixture="$fixtures/$name.yaml"

  if [[ -f "$fixture" ]]; then
    say "render $name (ci fixture)"
    helm template ci "$chart" -f "$fixture" >/dev/null \
      || { say "FAIL render $name with $fixture"; failed=1; return; }
  else
    say "render $name (default values)"
    helm template ci "$chart" >/dev/null || { say "FAIL render $name"; failed=1; return; }
  fi

  if (( deps_vendored )); then
    rm -rf "$chart/charts" "$chart/Chart.lock"
  fi
}

checked=0

for chart in "$charts_dir"/*/; do
  if [[ -f "$chart/Chart.yaml" ]]; then
    check "${chart%/}"
    checked=$((checked + 1))
  fi
done

# A tree that exists but holds no charts is also a false green.
(( checked > 0 )) || { say "FAIL: no charts found under $charts_dir"; exit 1; }

check "$umbrella"

databases="$root/deploy/databases"
check "$databases"

source "$root/scripts/ci/render-assertions.sh"
render_databases() { helm template lore-databases "$databases" "$@"; }

say "assertions on lore-databases"
base="$(render_databases)"
rendered_count "$base" "two CloudNativePG clusters" '.kind == "Cluster"' 2
rendered_has "$base" "lore-db is a cluster named lore-db, in lore-db, owned by lore, with pgvector" \
  '.kind == "Cluster" and .metadata.name == "lore-db" and .metadata.namespace == "lore-db" and .spec.bootstrap.initdb.owner == "lore" and (.spec.bootstrap.initdb.postInitApplicationSQL | index("CREATE EXTENSION IF NOT EXISTS vector") != null)'
rendered_has "$base" "floor-db is a cluster named floor-db owned by floor, with no extension" \
  '.kind == "Cluster" and .metadata.name == "floor-db" and .spec.bootstrap.initdb.owner == "floor" and (.spec.bootstrap.initdb | has("postInitApplicationSQL") | not)'
rendered_count "$base" "the six Secrets the clusters and the install chart read" \
  '.kind == "Secret" and ([.metadata.namespace + "/" + .metadata.name] | inside(["lore-db/lore-db-credentials", "lore-db/floor-db-credentials", "lore-api/lore-api-db-password", "lore-ui/lore-db-password", "lore-stations/lore-stations-db-password", "lore-floor/floor-postgres"]))' 6
rendered_count "$base" "every Secret is kept on uninstall" \
  '.kind == "Secret" and .metadata.annotations["helm.sh/resource-policy"] == "keep"' 6
rendered_has "$base" "floor-postgres carries a connection string to floor-db" \
  '.kind == "Secret" and .metadata.name == "floor-postgres" and (.stringData.connectionString | startswith("postgres://floor:") and contains("@floor-db-rw.lore-db.svc.cluster.local:5432/floor"))'
rendered_has "$base" "the Secret namespaces are created" \
  '.kind == "Namespace" and .metadata.name == "lore-floor"'
rendered_text_lacks "$base" "no Google bucket" 'gs://'
rendered_text_lacks "$base" "no Google identity" 'iam.gke.io'
rendered_text_lacks "$base" "no GKE environment" 'gkeEnvironment'
rendered_lacks "$base" "no backup objects without a backup" '.kind == "ObjectStore" or .kind == "ScheduledBackup"'
rendered_lacks "$base" "no storage class unless asked" '.kind == "Cluster" and (.spec.storage | has("storageClass"))'
rendered_lacks "$base" "no image without a digest" '.kind == "Cluster" and (.spec.imageName | contains("@sha256:") | not)'
backed_up="$(render_databases -f "$fixtures/databases-backup.yaml" --set lore.storageClass=fast)"
rendered_has "$backed_up" "backup renders the ObjectStore as written, the plugin and a ScheduledBackup" \
  '.kind == "ObjectStore" and .metadata.name == "lore-db-backup" and .spec.configuration.destinationPath == "https://acct.blob.core.windows.net/backups/lore-db" and .spec.retentionPolicy == "7d"'
rendered_has "$backed_up" "the backed up cluster archives WAL through the plugin" \
  '.kind == "Cluster" and .metadata.name == "lore-db" and .spec.plugins[0].parameters.barmanObjectName == "lore-db-backup" and .spec.plugins[0].isWALArchiver == true'
rendered_has "$backed_up" "the schedule is the one given" '.kind == "ScheduledBackup" and .spec.schedule == "0 0 2 * * *" and .spec.cluster.name == "lore-db"'
rendered_has "$backed_up" "lore.storageClass is used" '.kind == "Cluster" and .metadata.name == "lore-db" and .spec.storage.storageClass == "fast"'
rendered_lacks "$backed_up" "floor-db has no backup when only lore has one" '.kind == "ScheduledBackup" and .spec.cluster.name == "floor-db"'
placed="$(render_databases --set global.nodeSelector.pool=management --set 'global.tolerations[0].key=pool' --set 'global.tolerations[0].operator=Exists')"
rendered_count "$placed" "global.nodeSelector and tolerations reach both clusters" \
  '.kind == "Cluster" and .spec.affinity.nodeSelector.pool == "management" and (.spec.affinity.tolerations | length) == 1' 2
rendered_count "$(render_databases --set podSecurity=baseline)" "Pod Security labels on the three Lore namespaces it creates" \
  '.kind == "Namespace" and .metadata.labels["pod-security.kubernetes.io/enforce"] == "baseline"' 3
finish_assertions "lore-databases render assertions"

if (( failed )); then
  say "FAILED"
  exit 1
fi

say "$checked chart(s) + the umbrella lint and render"
