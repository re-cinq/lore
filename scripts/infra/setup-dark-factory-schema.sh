#!/usr/bin/env bash
set -euo pipefail

BASELINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../deploy/chart/charts/ui-helm/baseline" && pwd)"

# Dark Factory schema migration (spec 6-dark-factory).
# Idempotent — safe to re-run.

NS="lore-db"
POD="lore-db-1"

echo "[lore] Applying dark-factory schema migration..."

kubectl exec -i -n "$NS" "$POD" -- psql -U postgres -d lore -v ON_ERROR_STOP=1 --single-transaction -f - < "$BASELINE_DIR/06_dark_factory.sql"

echo "[lore] Dark-factory schema migration complete."
echo "[lore] Verify with: kubectl exec -n $NS $POD -- psql -U postgres -d lore -c '\\d pipeline.task_leases'"
