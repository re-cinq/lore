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
# Storage starts at 50Gi on pd-balanced (~$5/mo) — the memory + spec-trace
# graphs are tens of GB at most. GKE PVs expand ONLINE (no downtime, never
# shrink), so there is no reason to pre-pay for capacity: bump
# var.dgraph_storage_size when the data actually approaches the ceiling.
#
# Apps reach it via LORE_DGRAPH_HTTP (createDgraphClient in
# shared/src/dgraph-client.ts); unset → the client is null and /impact + graph
# ingest fail soft. Wired into lore-api + agent in lore-platform.tf / lore-floor.tf.
# ---------------------------------------------------------------------------

variable "dgraph_storage_size" {
  description = "Persistent volume size for the shared Dgraph instance (memory + spec-trace graphs). Expands online; start modest."
  type        = string
  default     = "50Gi"
}

variable "dgraph_storage_class" {
  description = "StorageClass for the Dgraph PV. standard-rwo = pd-balanced (the DB-grade default); premium-rwo = pd-ssd only if QPS demands it."
  type        = string
  default     = "standard-rwo"
}

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

resource "kubernetes_namespace" "lore_dgraph" {
  metadata {
    name = local.dgraph_namespace
  }
}

# ── Headless service (StatefulSet governance + client DNS) ──────────
# clusterIP: None → the service name resolves to the pod IP; single-replica
# clients (createDgraphClient) hit it directly. 8080 = alpha HTTP (/alter,
# /query, /mutate), 9080 = alpha gRPC.

resource "kubectl_manifest" "lore_dgraph_service" {
  yaml_body = yamlencode({
    apiVersion = "v1"
    kind       = "Service"
    metadata = {
      name      = local.dgraph_service_name
      namespace = local.dgraph_namespace
      labels    = { app = "lore-dgraph" }
    }
    spec = {
      clusterIP = "None"
      selector  = { app = "lore-dgraph" }
      ports = [
        { name = "http", port = 8080, targetPort = 8080 },
        { name = "grpc", port = 9080, targetPort = 9080 },
      ]
    }
  })

  depends_on = [kubernetes_namespace.lore_dgraph]
}

# ── StatefulSet (dgraph/standalone) ────────────────────────────────

resource "kubectl_manifest" "lore_dgraph_statefulset" {
  yaml_body = yamlencode({
    apiVersion = "apps/v1"
    kind       = "StatefulSet"
    metadata = {
      name      = local.dgraph_service_name
      namespace = local.dgraph_namespace
      labels    = { app = "lore-dgraph" }
    }
    spec = {
      serviceName = local.dgraph_service_name
      replicas    = 1
      selector    = { matchLabels = { app = "lore-dgraph" } }
      template = {
        metadata = { labels = { app = "lore-dgraph" } }
        spec = {
          securityContext = {
            runAsUser  = 1000
            runAsGroup = 1000
            fsGroup    = 1000
          }
          containers = [{
            name  = "dgraph"
            image = "dgraph/standalone:v24.0.0"
            ports = [
              { name = "http", containerPort = 8080 },
              { name = "grpc", containerPort = 9080 },
            ]
            volumeMounts = [{ name = "data", mountPath = "/dgraph" }]
            resources = {
              requests = { cpu = "1", memory = "4Gi" }
              limits   = { cpu = "4", memory = var.dgraph_memory_limit }
            }
            readinessProbe = {
              httpGet             = { path = "/health", port = 8080 }
              initialDelaySeconds = 15
              periodSeconds       = 10
            }
            livenessProbe = {
              httpGet             = { path = "/health", port = 8080 }
              initialDelaySeconds = 30
              periodSeconds       = 30
            }
          }]
        }
      }
      volumeClaimTemplates = [{
        metadata = { name = "data" }
        spec = {
          accessModes      = ["ReadWriteOnce"]
          storageClassName = var.dgraph_storage_class
          resources        = { requests = { storage = var.dgraph_storage_size } }
        }
      }]
    }
  })

  wait_for_rollout = false

  depends_on = [kubectl_manifest.lore_dgraph_service]
}

# ── Schema appliers (additive /alter) as a ConfigMap + Job ─────────
# Both setup-*-schema.sh scripts POST their DQL schema to $DGRAPH_HTTP/alter,
# which MERGES (additive) — so applying memory then spec-trace yields the union.
# Idempotent: re-applying an unchanged schema is a no-op, so this Job is safe to
# re-run on every apply (ttlSecondsAfterFinished cleans it up).

resource "kubernetes_config_map_v1" "lore_dgraph_schema" {
  metadata {
    name      = "lore-dgraph-schema"
    namespace = local.dgraph_namespace
  }
  data = {
    "setup-memory-dgraph-schema.sh" = file("${path.module}/../../scripts/infra/setup-memory-dgraph-schema.sh")
    "setup-spec-trace-schema.sh"    = file("${path.module}/../../scripts/infra/setup-spec-trace-schema.sh")
  }

  depends_on = [kubernetes_namespace.lore_dgraph]
}

resource "kubectl_manifest" "lore_dgraph_schema_job" {
  yaml_body = yamlencode({
    apiVersion = "batch/v1"
    kind       = "Job"
    metadata = {
      name      = "lore-dgraph-schema-apply"
      namespace = local.dgraph_namespace
    }
    spec = {
      backoffLimit            = 6
      ttlSecondsAfterFinished = 300
      template = {
        spec = {
          restartPolicy = "OnFailure"
          containers = [{
            name    = "apply-schema"
            image   = "alpine:3.20"
            command = ["/bin/sh", "-c"]
            args = [
              "apk add --no-cache bash curl >/dev/null && bash /schema/setup-memory-dgraph-schema.sh && bash /schema/setup-spec-trace-schema.sh",
            ]
            env          = [{ name = "DGRAPH_HTTP", value = local.dgraph_http_url }]
            volumeMounts = [{ name = "schema", mountPath = "/schema" }]
          }]
          volumes = [{
            name      = "schema"
            configMap = { name = "lore-dgraph-schema" }
          }]
        }
      }
    }
  })

  depends_on = [
    kubectl_manifest.lore_dgraph_statefulset,
    kubernetes_config_map_v1.lore_dgraph_schema,
  ]
}

output "lore_dgraph_http_url" {
  description = "In-cluster Dgraph HTTP endpoint (LORE_DGRAPH_HTTP) for mcp-server + agent."
  value       = local.dgraph_http_url
}
