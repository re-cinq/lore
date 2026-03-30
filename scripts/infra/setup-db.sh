#!/usr/bin/env bash
set -euo pipefail

# Deploy PostgreSQL + pgvector via CloudNativePG (CNPG) operator.
#
# CNPG is a CNCF Kubernetes operator for PostgreSQL. Handles HA,
# failover, backups, and pgvector natively. Replaces both Bitnami
# PostgreSQL (unmaintained) and PostgreSQL (CNPG) (restricted registry).
#
# Upgrade path to PostgreSQL (CNPG)/managed PostgreSQL: swap the Cluster
# resource for PostgreSQL, keep the same schema DDL. All SQL queries
# are compatible — pgvector HNSW and PostgreSQL HNSW use the same
# <=> operator.
#
# Usage: ./scripts/infra/setup-lore-db.sh [password]

NAMESPACE="lore-db"
DB_PASSWORD="${1:-${ALLOYDB_PASSWORD:?Set ALLOYDB_PASSWORD or pass password as first argument}}"

# Check if CNPG operator is already installed
if kubectl get crd clusters.postgresql.cnpg.io &>/dev/null; then
  echo "[lore] CloudNativePG operator already installed, skipping."
else
  echo "[lore] Installing CloudNativePG operator..."
  helm upgrade --install cnpg cloudnative-pg \
    --repo https://cloudnative-pg.github.io/charts \
    --namespace cnpg-system \
    --create-namespace \
    --wait --timeout 5m
  echo "[lore] Waiting for CNPG operator to be ready..."
  kubectl wait --for=condition=available deployment/cnpg-controller-manager \
    -n cnpg-system --timeout=120s
fi

echo "[lore] Creating PostgreSQL cluster with pgvector..."

kubectl apply -n "$NAMESPACE" -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: lore-db-credentials
type: kubernetes.io/basic-auth
stringData:
  username: postgres
  password: "$DB_PASSWORD"
---
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: lore-db
spec:
  instances: 1
  imageName: ghcr.io/cloudnative-pg/postgresql:16-bookworm

  bootstrap:
    initdb:
      database: lore
      owner: postgres
      secret:
        name: lore-db-credentials
      postInitSQL:
        - CREATE EXTENSION IF NOT EXISTS vector

  storage:
    size: 50Gi

  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: "2"
      memory: 4Gi

  postgresql:
    shared_preload_libraries:
      - vector
EOF

echo "[lore] Waiting for database to be ready..."
kubectl wait --for=condition=ready cluster/lore-db \
  -n "$NAMESPACE" --timeout=300s 2>/dev/null || \
  echo "[lore] Waiting for pod directly..."

# Wait for the primary pod
for i in {1..60}; do
  if kubectl get pod lore-db-1 -n "$NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null | grep -q Running; then
    break
  fi
  sleep 5
done

echo "[lore] Creating schemas and indexes..."
kubectl exec -n "$NAMESPACE" lore-db-1 -- psql -U postgres -d lore -c "
  CREATE EXTENSION IF NOT EXISTS vector;

  DO \$\$
  DECLARE
    s TEXT;
  BEGIN
    FOREACH s IN ARRAY ARRAY['payments', 'platform', 'mobile', 'data', 'org_shared']
    LOOP
      EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', s);
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.chunks (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          content       TEXT NOT NULL,
          embedding     VECTOR(768),
          content_type  TEXT,
          team          TEXT,
          repo          TEXT,
          file_path     TEXT,
          author        TEXT,
          ingested_at   TIMESTAMPTZ DEFAULT NOW(),
          metadata      JSONB,
          search_tsv    TSVECTOR GENERATED ALWAYS AS (to_tsvector(''english'', content)) STORED
        )', s);
      EXECUTE format('
        CREATE INDEX IF NOT EXISTS %I_chunks_embedding_idx
        ON %I.chunks USING hnsw (embedding vector_cosine_ops)', s, s);
      EXECUTE format('
        CREATE INDEX IF NOT EXISTS %I_chunks_search_idx
        ON %I.chunks USING GIN (search_tsv)', s, s);
    END LOOP;
  END\$\$;
"

echo ""
echo "[lore] PostgreSQL + pgvector is ready (via CloudNativePG)."
echo "  Schemas: payments, platform, mobile, data, org_shared"
echo "  Connect: kubectl port-forward svc/lore-db-rw 5432:5432 -n $NAMESPACE"
echo "  Then:    psql -h localhost -U postgres -d lore"
