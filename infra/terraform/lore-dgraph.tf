# ---------------------------------------------------------------------------
# Dgraph — SHARED graph store for BOTH the memory graph (memory-dgraph-migration)
# and the spec-traceability graph (trace_impact / projectSpecFile). One instance,
# two schemas applied additively to the same /alter endpoint.
#
# Shape: a single StatefulSet running dgraph/standalone (zero+alpha in one pod) —
# matches compose.yaml v24.0.0 for dev/prod parity and is sufficient for this
# write-light, read-light workload. Scale to a split zero/alpha + HA StatefulSet
# later if QPS demands it; the Service DNS the apps consume stays the same.
#
# The StatefulSet itself ships in the umbrella chart (deploy/chart/templates/lore-dgraph.yaml);
# this file keeps the in-cluster URL the apps and the outputs use.
#
# Apps reach it via LORE_DGRAPH_HTTP (createDgraphClient in
# shared/src/dgraph-client.ts); unset → the client is null and /impact + graph
# ingest fail soft. Wired into lore-api + agent in lore-platform.tf / lore-floor.tf.
# ---------------------------------------------------------------------------

variable "dgraph_memory_limit" {
  description = "Memory limit for the Dgraph pod. Dgraph caches posting lists in RAM; raise for larger graphs."
  type        = string
  default     = "16Gi"
}

locals {
  dgraph_namespace    = "lore-dgraph"
  dgraph_service_name = "lore-dgraph-alpha"
  # The in-cluster HTTP endpoint apps put in LORE_DGRAPH_HTTP.
  dgraph_http_url = "http://${local.dgraph_service_name}.${local.dgraph_namespace}.svc.cluster.local:8080"
}

# ── Namespace ───────────────────────────────────────────────────────

# ── Headless service (StatefulSet governance + client DNS) ──────────
# clusterIP: None → the service name resolves to the pod IP; single-replica
# clients (createDgraphClient) hit it directly. 8080 = alpha HTTP (/alter,
# /query, /mutate), 9080 = alpha gRPC.

# ── StatefulSet (dgraph/standalone) ────────────────────────────────

# ── Disruption budget ──────────────────────────────────────────────
# Without this, node consolidation can delete the one pod at any time, and its
# ReadWriteOnce disk can stay attached to the old node while the new pod waits:
# 4 such deletions in the 30 days to 2026-11-01, two of them about 40 minutes
# down. The autoscaler won't remove a node this budget protects. A node upgrade
# still finishes, because GKE honours the budget for an hour and then evicts.
# A budget rather than the safe-to-evict annotation, which changes the pod
# template and so restarts Dgraph when applied.

# ── Schema appliers (additive /alter) as a ConfigMap + Job ─────────
# Both setup-*-schema.sh scripts POST their DQL schema to $DGRAPH_HTTP/alter,
# which MERGES (additive) — so applying memory then spec-trace yields the union.
# Idempotent: re-applying an unchanged schema is a no-op, so this Job is safe to
# re-run on every apply (ttlSecondsAfterFinished cleans it up).

output "lore_dgraph_http_url" {
  description = "In-cluster Dgraph HTTP endpoint (LORE_DGRAPH_HTTP) for mcp-server + agent."
  value       = local.dgraph_http_url
}
