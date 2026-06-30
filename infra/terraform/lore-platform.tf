# --------------------------------------------------------------------------
# Lore platform — ONE Helm release for all five application workloads.
#
# Replaces the former per-service releases (lore-floor, lore-mcp, lore-ui,
# lore-db extras, ai-agents). The umbrella chart vendors them as subcharts and
# stamps each resource with its own namespace, so this single release spans
# lore-floor / mcp-servers / lore-ui / lore-db / ai-agents. The release record
# lives in the `lore-floor` home namespace.
#
# Deploy ownership: Terraform owns config (the `values` below); CI owns image
# tags. `reuse_values = true` means a `terraform apply` MERGES this config on
# top of the live release's values WITHOUT resetting image tags — so it never
# downgrades the SHA-pinned images CI deploys (`helm upgrade --set
# <svc>.image.tag=<sha> --reset-then-reuse-values`).
#
# Values are nested under each subchart's chart name:
#   lore-floor / lore-mcp / lore-ui / lore-db-helm / ai-agents
# Cluster, namespaces, ESO ExternalSecrets, the 2 ingresses, the CNPG cluster
# CR, and Dgraph remain Terraform-owned (see the other *.tf files).
# --------------------------------------------------------------------------

resource "helm_release" "lore_platform" {
  name             = "lore-platform"
  chart            = "${path.module}/modules/gke-mcp/lore-platform"
  namespace        = "lore-floor"
  create_namespace = false

  # Preserve CI-deployed image tags across terraform applies (see header).
  reuse_values = true

  values = [yamlencode({
    # ---- Floor (lore-floor namespace) ----
    "lore-floor" = {
      taskTypesConfig = file("${path.module}/../../scripts/task-types.yaml")
      gcpProject      = var.project_id
      env = {
        LORE_DB_HOST     = "lore-db-rw.lore-db.svc.cluster.local"
        LORE_DB_PORT     = "5432"
        LORE_DB_NAME     = "lore"
        LORE_DB_USER     = "lore"
        LORE_DGRAPH_HTTP = local.dgraph_http_url
        ANTHROPIC_MODEL  = "claude-haiku-4-5-20251001"
        TASK_TYPES_PATH  = "/config/task-types.yaml"
        PORT             = "8080"
        LORE_INGEST_URL  = var.lore_api_url
        LORE_LOG_BUCKET  = "lore-task-logs-${var.project_id}"
      }
      dbPasswordSecret        = { name = "lore-db-password", key = "password" }
      anthropicKeySecret      = { name = "lore-anthropic-key", key = "anthropic-api-key" }
      anthropicAdminKeySecret = { name = "lore-anthropic-key", key = "anthropic-admin-key" }
      githubAppSecret = {
        name              = "github-app-credentials"
        appIdKey          = "app-id"
        privateKeyKey     = "private-key"
        installationIdKey = "installation-id"
      }
      ingestTokenSecret   = { name = "lore-ingest-token", key = "token" }
      internalTokenSecret = { name = "lore-agent-internal-token", key = "token" }
      webhookSecret       = { name = "lore-floor-webhook-secret", key = "secret" }
    }

    # ---- MCP server (mcp-servers namespace) ----
    "lore-mcp" = {
      taskTypesConfig = file("${path.module}/../../scripts/task-types.yaml")
      replicaCount    = 1
      env = {
        PORT             = "3000"
        CONTEXT_PATH     = "/context"
        TASK_TYPES_PATH  = "/config/task-types.yaml"
        LORE_TEAM        = "platform"
        GCP_PROJECT      = var.project_id
        LORE_DB_HOST     = "lore-db-rw.lore-db.svc.cluster.local"
        LORE_DB_PORT     = "5432"
        LORE_DB_NAME     = "lore"
        LORE_DB_USER     = "lore"
        LORE_DGRAPH_HTTP = local.dgraph_http_url
        LORE_AGENT_URL   = "http://lore-floor.lore-floor.svc.cluster.local:8080"
        LORE_WEBHOOK_URL = var.lore_webhook_hostname != "" ? "https://${var.lore_webhook_hostname}/api/webhook/github" : ""
      }
      dbPasswordSecret  = { name = "lore-mcp-db-password", key = "password" }
      ingestTokenSecret = { name = "lore-ingest-token", key = "token" }
      githubAppSecret = {
        name              = "github-app-credentials"
        appIdKey          = "app-id"
        privateKeyKey     = "private-key"
        installationIdKey = "installation-id"
      }
      webhookSecret       = { name = "lore-webhook-secret", key = "secret" }
      internalTokenSecret = { name = "lore-agent-internal-token", key = "token" }
    }

    # ---- Web UI (lore-ui namespace) ----
    "lore-ui" = {
      replicaCount = 1
      env = {
        LORE_DB_HOST       = "lore-db-rw.lore-db.svc.cluster.local"
        LORE_DB_PORT       = "5432"
        LORE_DB_NAME       = "lore"
        LORE_DB_USER       = "lore"
        GITHUB_ALLOWED_ORG = var.github_org
        NEXTAUTH_URL       = var.lore_ui_url
        LORE_LOG_BUCKET    = "lore-task-logs-${var.project_id}"
        LORE_API_URL       = "http://lore-mcp.mcp-servers.svc.cluster.local:3000"
      }
      dbPasswordSecret  = { name = "lore-db-password", key = "password" }
      ingestTokenSecret = { name = "lore-ingest-token", key = "token" }
      githubAppSecret   = { name = "github-app-credentials" }
      oauthSecret       = { name = "lore-ui-oauth" }
    }

    # ---- lore-db ownership-reconciler add-on (lore-db namespace) ----
    "lore-db-helm" = {
      cluster = { name = "lore-db" }
      # Terraform (privileged) always runs the ownership-reconciler hook; CI deploys
      # disable it (their SA can't manage lore-db RBAC). reuse_values would otherwise
      # carry CI's `false` forward, so set it true explicitly here.
      ownershipReconciler = { enabled = true }
    }

    # ai-agents: 1 controller replica (leader-election still elects the sole pod);
    # other config (seedCatalog, image digests, cross-ns refs) stays subchart default.
    "ai-agents" = {
      controller = { replicas = 1 }
    }
  })]

  depends_on = [
    kubernetes_namespace.lore_agent,
    kubernetes_namespace.mcp_servers,
    kubernetes_namespace.lore_ui,
    kubernetes_namespace.lore_db,
    kubernetes_namespace.ai_agents,
    kubernetes_service_account.lore_ui,
    kubectl_manifest.lore_db_cluster,
    kubectl_manifest.es_ai_agents_secrets,
    kubectl_manifest.es_ai_agents_ghcr,
    kubectl_manifest.es_ai_agents_events_auth,
  ]
}
