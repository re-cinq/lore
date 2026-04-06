#!/usr/bin/env bash
set -euo pipefail

# Apply schema DDL to the lore-db PostgreSQL cluster (CNPG).
#
# The CNPG operator, Cluster CR, backup infrastructure, and namespace are
# all managed by Terraform (terraform/lore-db.tf). Run `terraform apply`
# first to bring up the cluster, then run this script to initialise schemas.
#
# Usage: ./scripts/infra/setup-db.sh

NAMESPACE="lore-db"

echo "[lore] Waiting for lore-db cluster to be ready..."
kubectl wait --for=condition=ready cluster/lore-db \
  -n "$NAMESPACE" --timeout=300s 2>/dev/null || \
  echo "[lore] Cluster condition not yet available, waiting for pod directly..."

# Wait for the primary pod
for i in {1..60}; do
  if kubectl get pod lore-db-1 -n "$NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null | grep -q Running; then
    break
  fi
  echo "[lore] Waiting for lore-db-1 pod... (${i}/60)"
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
