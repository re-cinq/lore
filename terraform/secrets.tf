locals {
  secrets = {
    "lore-github-app-id"              = var.github_app_id
    "lore-github-app-private-key"     = var.github_app_private_key
    "lore-github-app-installation-id" = var.github_app_installation_id
    "lore-anthropic-api-key"          = var.anthropic_api_key
    "lore-db-password"                = var.db_password
    "lore-ingest-token"               = var.ingest_token
    "lore-webhook-secret"             = var.webhook_secret
    "lore-github-oauth-client-id"     = var.github_oauth_client_id
    "lore-github-oauth-client-secret" = var.github_oauth_client_secret
    "lore-nextauth-secret"            = var.nextauth_secret
  }
}

resource "google_secret_manager_secret" "lore" {
  for_each  = local.secrets
  secret_id = each.key

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "lore" {
  for_each    = local.secrets
  secret      = google_secret_manager_secret.lore[each.key].id
  secret_data = each.value
}

# GHCR pull secret stored separately (binary/base64 content)
resource "google_secret_manager_secret" "ghcr" {
  secret_id = "lore-ghcr-pull-secret"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "ghcr" {
  secret      = google_secret_manager_secret.ghcr.id
  secret_data = var.ghcr_pull_secret_dockerconfigjson
}
