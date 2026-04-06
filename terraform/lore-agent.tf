# --------------------------------------------------------------------------
# Lore Agent — Helm release
# --------------------------------------------------------------------------

resource "helm_release" "lore_agent" {
  name             = "lore-agent"
  chart            = "${path.module}/modules/gke-mcp/agent-helm"
  namespace        = "lore-agent"
  create_namespace = false

  set {
    name  = "image.tag"
    value = "latest"
  }

  # DB config (plain values)
  set {
    name  = "env.LORE_DB_HOST"
    value = "lore-db-rw.lore-db.svc.cluster.local"
  }
  set {
    name  = "env.LORE_DB_PORT"
    value = "5432"
  }
  set {
    name  = "env.LORE_DB_NAME"
    value = "lore"
  }
  set {
    name  = "env.LORE_DB_USER"
    value = "lore"
  }
  set {
    name  = "env.ANTHROPIC_MODEL"
    value = "claude-haiku-4-5-20251001"
  }
  set {
    name  = "env.TASK_TYPES_PATH"
    value = "/config/task-types.yaml"
  }
  set {
    name  = "env.PORT"
    value = "8080"
  }
  set {
    name  = "env.LORE_INGEST_URL"
    value = var.lore_api_url
  }
  set {
    name  = "env.LORE_LOG_BUCKET"
    value = "lore-task-logs-${var.project_id}"
  }
  set {
    name  = "gcpProject"
    value = var.project_id
  }

  # Secrets — reference ESO-managed K8s Secrets
  set {
    name  = "dbPasswordSecret.name"
    value = "lore-db-password"
  }
  set {
    name  = "dbPasswordSecret.key"
    value = "password"
  }
  set {
    name  = "anthropicKeySecret.name"
    value = "lore-anthropic-key"
  }
  set {
    name  = "anthropicKeySecret.key"
    value = "anthropic-api-key"
  }
  set {
    name  = "githubAppSecret.name"
    value = "github-app-credentials"
  }
  set {
    name  = "githubAppSecret.appIdKey"
    value = "app-id"
  }
  set {
    name  = "githubAppSecret.privateKeyKey"
    value = "private-key"
  }
  set {
    name  = "githubAppSecret.installationIdKey"
    value = "installation-id"
  }
  set {
    name  = "ingestTokenSecret.name"
    value = "lore-ingest-token"
  }
  set {
    name  = "ingestTokenSecret.key"
    value = "token"
  }

  depends_on = [
    kubernetes_namespace.lore_agent,
    kubernetes_config_map.agent_config,
  ]
}
