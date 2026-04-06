#!/usr/bin/env bash
set -euo pipefail

# Generate vector embeddings for all chunks in PostgreSQL using Vertex AI.
#
# Reads chunks without embeddings, calls Vertex AI text-embedding-005,
# writes embeddings back. Runs from a machine with gcloud auth.
#
# Usage: ./scripts/infra/generate-embeddings.sh [--schema org_shared] [--batch-size 5]

PROJECT="${GCP_PROJECT:?GCP_PROJECT must be set}"
REGION="${GCP_REGION:-europe-west1}"
SCHEMA="${1:-all}"
BATCH_SIZE="${2:-5}"
NS="lore-db"
POD="lore-db-1"
MODEL="text-embedding-005"
TOTAL=0
ERRORS=0

get_access_token() {
  gcloud auth print-access-token 2>/dev/null
}

embed_text() {
  local text="$1"
  local token="$2"
  # Call Vertex AI embedding API
  curl -sf -X POST \
    "https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/publishers/google/models/${MODEL}:predict" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg text "$text" '{
      instances: [{ content: $text }]
    }')" 2>/dev/null | jq -r '.predictions[0].embeddings.values | @csv' 2>/dev/null
}

process_schema() {
  local schema="$1"
  local token="$2"

  # Get chunks without embeddings
  local ids
  ids=$(kubectl exec -n "$NS" "$POD" -- psql -U postgres -d lore -t -A -c "
    SELECT id FROM ${schema}.chunks WHERE embedding IS NULL ORDER BY ingested_at;
  " 2>/dev/null | tr -d '\r')

  local count
  count=$(echo "$ids" | grep -c . 2>/dev/null || echo 0)

  if [ "$count" -eq 0 ]; then
    echo "  $schema: no chunks need embeddings"
    return
  fi

  echo "  $schema: $count chunks to embed"

  for id in $ids; do
    [ -z "$id" ] && continue

    # Get chunk content (truncate to ~8000 chars to stay within token limits)
    local content
    content=$(kubectl exec -n "$NS" "$POD" -- psql -U postgres -d lore -t -A -c "
      SELECT substring(content, 1, 8000) FROM ${schema}.chunks WHERE id = '${id}';
    " 2>/dev/null | tr -d '\r')

    [ -z "$content" ] && continue

    # Get embedding from Vertex AI
    local csv
    csv=$(embed_text "$content" "$token")

    if [ -z "$csv" ] || [ "$csv" = "null" ]; then
      echo "    [!] Failed to embed chunk $id"
      ERRORS=$((ERRORS + 1))
      continue
    fi

    # Write embedding back to PostgreSQL
    kubectl exec -n "$NS" "$POD" -- psql -U postgres -d lore -c "
      UPDATE ${schema}.chunks
      SET embedding = '[${csv}]'::vector
      WHERE id = '${id}';
    " >/dev/null 2>&1

    TOTAL=$((TOTAL + 1))
    echo "    [$TOTAL] embedded $id"

    # Refresh token every 50 chunks (tokens expire after ~60 min)
    if [ $((TOTAL % 50)) -eq 0 ]; then
      token=$(get_access_token)
    fi
  done
}

echo "[lore] Generating embeddings via Vertex AI ($MODEL)..."
echo "  Project: $PROJECT"
echo "  Region: $REGION"
echo ""

TOKEN=$(get_access_token)
if [ -z "$TOKEN" ]; then
  echo "[lore] Error: gcloud auth failed. Run: gcloud auth login"
  exit 1
fi

# Test Vertex AI connectivity with a real embedding call
TEST_RESULT=$(curl -sf \
  "https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/publishers/google/models/${MODEL}:predict" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"instances": [{"content": "test"}]}' 2>/dev/null | jq -r '.predictions[0].embeddings.values | length' 2>/dev/null || echo "0")

if [ "$TEST_RESULT" = "0" ] || [ -z "$TEST_RESULT" ]; then
  echo "[lore] Error: Vertex AI embedding test failed."
  echo "  Ensure aiplatform.googleapis.com is enabled and $MODEL is available in $REGION"
  exit 1
fi
echo "[lore] Vertex AI connected ($TEST_RESULT dimensions)."
echo ""

if [ "$SCHEMA" = "all" ]; then
  for s in org_shared payments platform mobile data; do
    process_schema "$s" "$TOKEN"
  done
else
  process_schema "$SCHEMA" "$TOKEN"
fi

echo ""
echo "[lore] Embedding complete: $TOTAL chunks embedded, $ERRORS errors"

# Show final stats
kubectl exec -n "$NS" "$POD" -- psql -U postgres -d lore -c "
  SELECT 'org_shared' as schema, count(*) as total, count(embedding) as with_embedding FROM org_shared.chunks
  UNION ALL SELECT 'payments', count(*), count(embedding) FROM payments.chunks
  UNION ALL SELECT 'platform', count(*), count(embedding) FROM platform.chunks
  UNION ALL SELECT 'mobile', count(*), count(embedding) FROM mobile.chunks
  UNION ALL SELECT 'data', count(*), count(embedding) FROM data.chunks
  ORDER BY 1;
" 2>&1
