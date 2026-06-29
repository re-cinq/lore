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
  # Shared Dgraph (memory + spec-trace graphs). Enables /impact + graph reads;
  # unset → createDgraphClient returns null and those paths fail soft.
  set {
    name  = "env.LORE_DGRAPH_HTTP"
    value = local.dgraph_http_url
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
  set {
    name  = "webhookSecret.name"
    value = "lore-webhook-secret"
  }
  set {
    name  = "webhookSecret.key"
    value = "secret"
  }
  set {
    name  = "internalTokenSecret.name"
    value = "lore-agent-internal-token"
  }
  set {
    name  = "internalTokenSecret.key"
    value = "token"
  }
  set {
    name  = "env.LORE_AGENT_URL"
    value = "http://lore-floor.lore-floor.svc.cluster.local:8080"
  }
  # Canonical GitHub-webhook ingress URL (the Floor host) — used by the
  # /api/repos/:o/:r/webhook status + ensure endpoints to read/repoint repo hooks.
  # Empty when no webhook hostname is set → those endpoints report `unknown`.
  set {
    name  = "env.LORE_WEBHOOK_URL"
    value = var.lore_webhook_hostname != "" ? "https://${var.lore_webhook_hostname}/api/webhook/github" : ""
  }

  # Task type config — inlined from scripts/task-types.yaml.
  # Passed via `values` (not `set`) because helm's CLI parser
  # can't handle commas in multi-line string values.
  values = [
    yamlencode({
      taskTypesConfig = file("${path.module}/../../scripts/task-types.yaml")
    })
  ]

  depends_on = [
    kubernetes_namespace.mcp_servers,
  ]
}
