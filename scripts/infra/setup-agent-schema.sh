#!/usr/bin/env bash
set -euo pipefail

BASELINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../deploy/chart/charts/ui-helm/baseline" && pwd)"

NS="${LORE_DB_NS:-lore-db}"
POD="${LORE_DB_POD:-lore-db-1}"

echo "[lore] Creating agent schema tables..."

kubectl exec -i -n "$NS" "$POD" -- psql -U postgres -d lore -v ON_ERROR_STOP=1 --single-transaction -f - < "$BASELINE_DIR/04_agent.sql"

echo "[lore] Agent schema tables ready."
