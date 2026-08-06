# --------------------------------------------------------------------------
# Workload Identity: GCP service accounts + Kubernetes SA bindings
# --------------------------------------------------------------------------
#
# Each team MCP server gets a GCP SA with PostgreSQL (CNPG) client access scoped
# to its own schema + org_shared.
# --------------------------------------------------------------------------

# ----- Team MCP Service Accounts -----

locals {
  mcp_teams = ["payments", "platform", "mobile", "data"]
}

resource "google_service_account" "mcp_team" {
  for_each = toset(local.mcp_teams)

  account_id   = "lore-mcp-${each.key}"
  display_name = "MCP Server SA — ${each.key} team"
  project      = var.project_id
}

resource "google_project_iam_member" "mcp_team_lore-db_client" {
  for_each = toset(local.mcp_teams)

  project = var.project_id
  role    = "roles/lore-db.client"
  member  = "serviceAccount:${google_service_account.mcp_team[each.key].email}"
}

# Kubernetes service accounts for each team MCP server
resource "kubernetes_service_account" "mcp_team" {
  for_each = toset(local.mcp_teams)

  metadata {
    name      = "mcp-${each.key}"
    namespace = kubernetes_namespace.mcp_servers.metadata[0].name

    annotations = {
      "iam.gke.io/gcp-service-account" = google_service_account.mcp_team[each.key].email
    }

    labels = {
      managed-by = "terraform"
      team       = each.key
    }
  }
}

# Workload Identity binding: allow each k8s SA to act as its GCP SA
resource "google_service_account_iam_member" "mcp_team_workload_identity" {
  for_each = toset(local.mcp_teams)

  service_account_id = google_service_account.mcp_team[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[${kubernetes_namespace.mcp_servers.metadata[0].name}/mcp-${each.key}]"
}
