# --------------------------------------------------------------------------
# Lore MCP Server — Helm release
# --------------------------------------------------------------------------

resource "helm_release" "lore_mcp" {
  name             = "lore-mcp"
  chart            = "${path.module}/modules/gke-mcp/mcp-helm"
  namespace        = "mcp-servers"
  create_namespace = false

  set {
    name  = "image.tag"
    value = "latest"
  }

  # MCP server config (plain values)
  set {
    name  = "env.MCP_TRANSPORT"
    value = "http"
  }
  set {
    name  = "env.PORT"
    value = "3000"
  }
  set {
    name  = "env.CONTEXT_PATH"
    value = "/context"
  }
  set {
    name  = "env.TASK_TYPES_PATH"
    value = "/config/task-types.yaml"
  }
  set {
    name  = "env.LORE_TEAM"
    value = "platform"
  }
  set {
    name  = "env.GCP_PROJECT"
    value = var.project_id
  }
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

  # Secrets — reference ESO-managed K8s Secrets
  set {
    name  = "dbPasswordSecret.name"
    value = "lore-mcp-db-password"
  }
  set {
    name  = "dbPasswordSecret.key"
    value = "password"
  }
  set {
    name  = "ingestTokenSecret.name"
    value = "lore-ingest-token"
  }
  set {
    name  = "ingestTokenSecret.key"
    value = "token"
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

  depends_on = [
    kubernetes_namespace.mcp_servers,
  ]
}
