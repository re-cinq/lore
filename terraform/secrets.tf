locals {
  secrets = merge({
    "lore-github-app-id"              = var.github_app_id
    "lore-github-app-private-key"     = var.github_app_private_key
    "lore-github-app-installation-id" = var.github_app_installation_id
    "lore-anthropic-api-key"          = var.anthropic_api_key
    "lore-db-password"                = var.db_password
    "lore-ingest-token"               = var.ingest_token
    "lore-webhook-secret"             = var.webhook_secret
    "lore-agent-internal-token"       = var.agent_internal_token
    "lore-slack-signing-secret"       = var.slack_signing_secret
    "lore-slack-bot-token"            = var.slack_bot_token
    "lore-github-oauth-client-id"     = var.github_oauth_client_id
    "lore-github-oauth-client-secret" = var.github_oauth_client_secret
    "lore-nextauth-secret"            = var.nextauth_secret
    }, var.anthropic_admin_api_key != "" ? {
    "lore-anthropic-admin-api-key" = var.anthropic_admin_api_key
  } : {})
}

resource "google_secret_manager_secret" "lore" {
  # Iterate over the secret NAMES (keys), not the map itself: the map's values
  # are sensitive, and terraform forbids a sensitive-derived value as for_each
  # (it would leak as an instance key). nonsensitive() is safe here — only the
  # names are exposed, never the secret data. Instance keys are unchanged, so
  # this does not recreate any secret.
  for_each  = nonsensitive(toset(keys(local.secrets)))
  secret_id = each.key

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "lore" {
  for_each    = nonsensitive(toset(keys(local.secrets)))
  secret      = google_secret_manager_secret.lore[each.key].id
  secret_data = local.secrets[each.key] # still sensitive — accessed as a value, not a key
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
