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
charts_dir="$root/infra/terraform/modules/gke-mcp/lore-platform/charts"
umbrella="$root/infra/terraform/modules/gke-mcp/lore-platform"
fixtures="$root/infra/chart-ci-values"
failed=0

say() { echo "[charts] $*"; }

# Fail closed on a moved or renamed tree. Without this the loop below iterates an
# unmatched glob, checks nothing, and prints "all charts lint and render" — the
# exact false green this script exists to prevent, in the script itself.
[[ -d "$charts_dir" ]] || { say "FAIL: charts dir not found: $charts_dir"; exit 1; }
[[ -d "$umbrella" ]] || { say "FAIL: umbrella not found: $umbrella"; exit 1; }

check() {
  local chart="$1" name
  name="$(basename "$chart")"

  say "lint $name"
  helm lint "$chart" >/dev/null || { say "FAIL lint $name"; failed=1; return; }

  say "render $name (default values)"
  helm template ci "$chart" >/dev/null || { say "FAIL render $name"; failed=1; return; }

  # A fixture exists for charts whose templates are dormant under defaults.
  local fixture="$fixtures/$name.yaml"

  if [[ -f "$fixture" ]]; then
    say "render $name (ci fixture)"
    helm template ci "$chart" -f "$fixture" >/dev/null \
      || { say "FAIL render $name with $fixture"; failed=1; return; }
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

if (( failed )); then
  say "FAILED"
  exit 1
fi

say "$checked chart(s) + the umbrella lint and render"
