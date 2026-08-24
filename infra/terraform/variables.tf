variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "europe-west1"
}

variable "cluster_name" {
  description = "GKE cluster name"
  type        = string
}

# Secret values — pass via .tfvars or TF_VAR_ env

variable "github_app_id" {
  type      = string
  sensitive = true
}

variable "github_app_private_key" {
  type      = string
  sensitive = true
}

variable "github_app_installation_id" {
  type      = string
  sensitive = true
}

variable "anthropic_api_key" {
  type      = string
  sensitive = true
}

variable "anthropic_admin_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "ingest_token" {
  type      = string
  sensitive = true
}

# Gates the web-ui admin-token ExternalSecret. The web-ui calls the mcp-server's
# two-key-gated dark-factory settings endpoint with an admin-scoped token. Mint
# the token via the mcp `/api/tokens` endpoint (scope: admin), store it in GCP
# Secret Manager as `lore-admin-token`, then set this true and re-apply. Until
# then the UI's LORE_ADMIN_TOKEN env is unset (optional) and privileged settings
# saves surface an "API not configured" notice — general settings still persist.
variable "enable_ui_admin_token" {
  type    = bool
  default = false
}

variable "webhook_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "agent_internal_token" {
  description = "Shared secret between mcp-server and lore-floor for /api/trigger/* (e.g. review-reactor webhook fan-out)."
  type        = string
  sensitive   = true
}

variable "github_oauth_client_id" {
  type      = string
  sensitive = true
}

variable "github_oauth_client_secret" {
  type      = string
  sensitive = true
}

variable "nextauth_secret" {
  type      = string
  sensitive = true
}

variable "slack_signing_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "slack_bot_token" {
  type      = string
  sensitive = true
  default   = ""
}

variable "ghcr_pull_secret_dockerconfigjson" {
  type        = string
  sensitive   = true
  description = "Base64-encoded .dockerconfigjson for GHCR"
}

variable "log_retention_days" {
  description = "Number of days to retain task logs in GCS"
  type        = number
  default     = 30
}

variable "lore_api_url" {
  description = "External URL for the Lore API server (e.g. https://lore-api.example.com); also drives the lore-api ingress host"
  type        = string
  default     = ""
}

variable "lore_ui_url" {
  description = "External URL for the Lore Web UI (e.g. https://lore.example.com)"
  type        = string
  default     = ""
}

variable "lore_mcp_url" {
  description = "External base URL for the shared lore-mcp gateway that serves live Lore tools to agent pods (e.g. https://lore-mcp.example.com); drives the lore-mcp ingress host and the agent recipes' mcp_servers URL (with /mcp appended). Empty disables the ingress and leaves agent recipes without a live MCP endpoint."
  type        = string
  default     = ""
}

variable "lore_ui_hostname" {
  description = "Hostname for the Lore Web UI ingress (e.g. lore.example.com)"
  type        = string
  default     = ""
}

variable "github_org" {
  description = "GitHub organization name for OAuth access control"
  type        = string
  default     = ""
}

variable "lore_webhook_hostname" {
  description = "Hostname for the Floor GitHub-webhook ingress (e.g. lore-webhook.example.com). Empty disables the ingress. Retired once webhooks are re-pointed at the event router (ADR-044)."
  type        = string
  default     = ""
}

variable "lore_event_router_hostname" {
  description = "Hostname for the event-router ingress, where GitHub delivers webhooks (ADR-044). Empty disables the ingress. Stand this up and re-point the repos' webhooks BEFORE retiring lore_webhook_hostname."
  type        = string
  default     = ""
}
