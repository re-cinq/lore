#!/usr/bin/env bash
# Local web GUI for the prod lore-db (Adminer over a kubectl port-forward).
# Nothing is exposed in-cluster; the tunnel and creds live only for this run.
set -euo pipefail

NAMESPACE="lore-db"
DB_SERVICE="svc/lore-db-rw"
# CloudNativePG generates a basic-auth secret (username/password keys); the
# name terraform claims to create (lore-db-password) does not exist in-cluster.
DB_SECRET="${LORE_DB_GUI_SECRET:-lore-db-credentials}"
# Default off 5432 to dodge a local dev Postgres (scripts/dev-local.sh) on 5432.
LOCAL_DB_PORT="${LORE_DB_GUI_DB_PORT:-15432}"
ADMINER_PORT="${LORE_DB_GUI_WEB_PORT:-8080}"

for bin in kubectl docker; do
  command -v "$bin" >/dev/null 2>&1 || { echo "[lore] missing required tool: $bin" >&2; exit 1; }
done

kubectl get "$DB_SERVICE" -n "$NAMESPACE" >/dev/null 2>&1 \
  || { echo "[lore] cannot reach $DB_SERVICE in namespace $NAMESPACE (check kube context)" >&2; exit 1; }

kubectl get secret "$DB_SECRET" -n "$NAMESPACE" >/dev/null 2>&1 \
  || { echo "[lore] secret '$DB_SECRET' not found in $NAMESPACE; set LORE_DB_GUI_SECRET to the right name" >&2; exit 1; }

DB_USER="$(kubectl get secret "$DB_SECRET" -n "$NAMESPACE" -o jsonpath='{.data.username}' | base64 -d)"
DB_PASSWORD="$(kubectl get secret "$DB_SECRET" -n "$NAMESPACE" -o jsonpath='{.data.password}' | base64 -d)"

PF_PID=""
cleanup() {
  [ -n "$PF_PID" ] && kill "$PF_PID" >/dev/null 2>&1 || true
  echo "[lore] tunnel closed"
}
trap cleanup EXIT INT TERM

if (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ":${LOCAL_DB_PORT} "; then
  echo "[lore] port ${LOCAL_DB_PORT} is already in use (a local Postgres?); set LORE_DB_GUI_DB_PORT to a free port" >&2
  exit 1
fi

echo "[lore] opening tunnel: localhost:${LOCAL_DB_PORT} -> ${DB_SERVICE} (${NAMESPACE})"
PF_LOG="$(mktemp)"
kubectl port-forward "$DB_SERVICE" "${LOCAL_DB_PORT}:5432" -n "$NAMESPACE" >"$PF_LOG" 2>&1 &
PF_PID=$!
sleep 2
if ! kill -0 "$PF_PID" 2>/dev/null; then
  echo "[lore] tunnel failed to start:" >&2; cat "$PF_LOG" >&2; rm -f "$PF_LOG"; exit 1
fi
rm -f "$PF_LOG"

echo "[lore] Adminer:  http://localhost:${ADMINER_PORT}"
echo "[lore]   System:   PostgreSQL"
echo "[lore]   Server:   localhost:${LOCAL_DB_PORT}"
echo "[lore]   Username: ${DB_USER}"
echo "[lore]   Database: lore"
echo "[lore]   Password: (in your clipboard buffer below)"
echo "[lore] ---- password ----"
echo "$DB_PASSWORD"
echo "[lore] ------------------"
echo "[lore] Ctrl-C to stop."

# CNPG resets SSL handshakes, and that reset kills the port-forward; force the
# pgsql driver (libpq) to never attempt SSL so the tunnel survives.
docker run --rm --network host \
  -e ADMINER_DEFAULT_SERVER="localhost:${LOCAL_DB_PORT}" \
  -e PGSSLMODE=disable \
  adminer:latest >/dev/null 2>&1
