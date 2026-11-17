#!/usr/bin/env bash
set -euo pipefail

BASELINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../deploy/chart/charts/ui-helm/baseline" && pwd)"
NS="lore-db" POD="lore-db-1"
echo "[lore] Creating repos schema..."
kubectl exec -i -n "$NS" "$POD" -- psql -U postgres -d lore -v ON_ERROR_STOP=1 --single-transaction -f - < "$BASELINE_DIR/02_repos.sql"
echo "[lore] Repos schema created."
