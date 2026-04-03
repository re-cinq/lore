variable "project_id" {
  default = "re5-n8n-platform"
}

variable "region" {
  default = "europe-west1"
}

variable "cluster_name" {
  default = "n8n-cluster"
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

variable "db_password" {
  type      = string
  sensitive = true
}

variable "ingest_token" {
  type      = string
  sensitive = true
}

variable "webhook_secret" {
  type      = string
  sensitive = true
  default   = ""
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
  description = "External URL for the Lore MCP API server"
  type        = string
  default     = ""
}

variable "lore_ui_url" {
  description = "External URL for the Lore Web UI (e.g. https://lore.example.com)"
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
