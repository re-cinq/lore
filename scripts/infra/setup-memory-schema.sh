#!/usr/bin/env bash
set -euo pipefail

BASELINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../deploy/chart/charts/ui-helm/baseline" && pwd)"

# Create the memory schema and tables in the existing lore database.
# Run after setup-db.sh has created the lore database.

NS="lore-db"
POD="lore-db-1"

echo "[lore] Creating memory schema and tables..."

kubectl exec -i -n "$NS" "$POD" -- psql -U postgres -d lore -v ON_ERROR_STOP=1 --single-transaction -f - < "$BASELINE_DIR/05_memory.sql"

echo "[lore] Memory schema created."
