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

# Feature gates for optional secret-backed wiring.
#
# There are NO secret-value variables here any more. Secret material lives in
# GCP Secret Manager and nowhere else (see secrets.tf); Terraform resolves it by
# NAME. These booleans only answer "does this resource exist" — a question that
# is deployment topology, not a credential, and so belongs in a committed
# tfvars where the whole team can see it.

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

# Gates the org-admin Anthropic key used by the cost-sync maintenance job
# (#1348). When true, the anthropic ExternalSecrets carry an extra
# `anthropic-admin-key` entry sourced from `lore-anthropic-admin-api-key`.
variable "enable_anthropic_admin_key" {
  type    = bool
  default = false
}

# Gates satellite-cluster registration (specs/running-stations-in-any-k8s-cluster
# FR1). When true, `lore-cluster-agent-registration-token` is mirrored into the
# lore-api and lore-cluster-agent namespaces and lore-api starts accepting
# registrations; only the registration call uses it, every later call uses the
# per-agent token that registration mints. False leaves the route answering 401.
variable "enable_cluster_agent_registration" {
  type    = bool
  default = false
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

variable "lore_agent_events_hostname" {
  description = "Hostname for the Floor's agent-telemetry ingress (POST /api/agent-events), which registered SATELLITE clusters report run telemetry to with their own per-agent token. Empty disables the ingress and leaves the sink cluster-internal, which is exactly the behaviour before satellites existed — central-cluster pods reach it over in-cluster DNS either way."
  type        = string
  default     = ""
}
