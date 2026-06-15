# --------------------------------------------------------------------------
# Workload Identity: GCP service accounts + Kubernetes SA bindings
# --------------------------------------------------------------------------
#
# Each team MCP server gets a GCP SA with PostgreSQL (CNPG) client access scoped
# to its own schema + org_shared. Klaus agents get write access to
# ingestion schemas and GitHub read access.
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

# ----- Klaus Agent Service Account -----

resource "google_service_account" "klaus_agent" {
  account_id   = "lore-klaus-agent"
  display_name = "Klaus Agent SA — ingestion and GitHub access"
  project      = var.project_id
}

# PostgreSQL (CNPG) client — write to ingestion schemas
resource "google_project_iam_member" "klaus_lore-db_client" {
  project = var.project_id
  role    = "roles/lore-db.client"
  member  = "serviceAccount:${google_service_account.klaus_agent.email}"
}

# Source reader — read GitHub via Cloud Source Repositories if needed
resource "google_project_iam_member" "klaus_source_reader" {
  project = var.project_id
  role    = "roles/source.reader"
  member  = "serviceAccount:${google_service_account.klaus_agent.email}"
}

# Kubernetes service account for Klaus
resource "kubernetes_service_account" "klaus_agent" {
  metadata {
    name      = "klaus-agent"
    namespace = kubernetes_namespace.klaus.metadata[0].name

    annotations = {
      "iam.gke.io/gcp-service-account" = google_service_account.klaus_agent.email
    }

    labels = {
      managed-by = "terraform"
      component  = "agents"
    }
  }
}

# Workload Identity binding: allow Klaus k8s SA to act as its GCP SA
resource "google_service_account_iam_member" "klaus_workload_identity" {
  service_account_id = google_service_account.klaus_agent.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[${kubernetes_namespace.klaus.metadata[0].name}/klaus-agent]"
}
