#!/usr/bin/env bash
set -euo pipefail

# Retrieval latency benchmark — queries audit_log for p50/p95/p99.
# Run manually or via weekly cron.
# Usage: bash scripts/infra/benchmark-retrieval.sh

NS="lore-db"
POD="lore-db-1"

echo "[lore] Retrieval latency benchmark (last 7 days)"
echo "================================================="

kubectl exec -n "$NS" "$POD" -- psql -U postgres -d lore -c "
  SELECT
    operation as tool,
    count(*)::int as calls,
    round(percentile_cont(0.50) WITHIN GROUP (ORDER BY (metadata->>'latency_ms')::numeric)) as p50_ms,
    round(percentile_cont(0.95) WITHIN GROUP (ORDER BY (metadata->>'latency_ms')::numeric)) as p95_ms,
    round(percentile_cont(0.99) WITHIN GROUP (ORDER BY (metadata->>'latency_ms')::numeric)) as p99_ms
  FROM memory.audit_log
  WHERE metadata->>'latency_ms' IS NOT NULL
    AND created_at > now() - interval '7 days'
  GROUP BY operation
  ORDER BY calls DESC;
"

echo ""
echo "Data volumes:"
kubectl exec -n "$NS" "$POD" -- psql -U postgres -d lore -c "
  SELECT
    (SELECT count(*) FROM memory.memories WHERE is_deleted = FALSE) as memories,
    (SELECT count(*) FROM memory.facts WHERE valid_to IS NULL) as active_facts,
    (SELECT count(*) FROM memory.facts WHERE valid_to IS NOT NULL) as invalidated_facts,
    (SELECT count(*) FROM memory.episodes) as episodes,
    (SELECT count(*) FROM memory.entities) as entities,
    (SELECT count(*) FROM memory.edges WHERE valid_to IS NULL) as active_edges;
"

echo "[lore] Benchmark complete."
