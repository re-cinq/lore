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

# Gates the org-admin Anthropic key used by the cost-sync maintenance job
# (#1348). When true, the anthropic ExternalSecrets carry an extra
# `anthropic-admin-key` entry sourced from `lore-anthropic-admin-api-key`.
variable "enable_anthropic_admin_key" {
  type    = bool
  default = false
}

# Gates the Gemini credential for agent runs. When true, agent-secrets carries
# a GEMINI_API_KEY entry sourced from `lore-gemini-api-key` and the central
# cluster-agent's catalog render maps the gemini model family onto it — which
# is what makes the render contract ACCEPT gemini recipes instead of refusing
# them (specs/catalog-db-sync FR8). Left false, a gemini-model definition is
# refused per cluster and dispatch falls back to the org default.
variable "enable_gemini" {
  type    = bool
  default = false
}

# Gates the wiring to the external floor engine (namespace `floor`): the
# FLOOR_* env on lore-api and stations, the two service-token secrets, and the
# `lore-mcp-auth` key merged into the floor's `agent-secrets`. Seed
# lore-floor-service-token and lore-floor-git-credential-token first.
variable "enable_external_floor" {
  type    = bool
  default = false
}

# Gates satellite-cluster registration (specs/running-stations-in-any-k8s-cluster
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

variable "github_app_slug" {
  description = "Public slug of the GitHub App (github.com/apps/<slug>), for the Connect GitHub install link; empty shows no link"
  type        = string
  default     = ""
}

variable "lore_webhook_hostname" {
  description = "Hostname for the Floor's /api/webhook ingress (e.g. lore-webhook.example.com): the CI ingest doors (/api/webhook/ci-ingest, /api/webhook/ci-tests — consumer repos' vars.LORE_WEBHOOK_URL base) plus the legacy /api/webhook/github alias the ingress rewrites to the event-router (ADR-044). Empty disables the ingress."
  type        = string
  default     = ""
}

variable "lore_event_router_hostname" {
  description = "Hostname of the GitHub webhook URL (`/api/events`), served by lore-api since 2026-10-02 (ADR-044 amendment); LORE_WEBHOOK_URL on lore-api and the legacy alias on lore_webhook_hostname both resolve to it. Empty disables the ingress."
  type        = string
  default     = ""
}

variable "enable_headlamp" {
  description = "Keep Headlamp's Secret Manager entries; the dashboard runs on the internal cluster from re-cinq/infrastructure."
  type        = bool
  default     = false
}

variable "enable_monitoring" {
  description = "Keep Grafana's Secret Manager entries and GCP identity; the stack runs on the internal cluster from re-cinq/infrastructure."
  type        = bool
  default     = false
}

# Gates Utopia (utopia.tf): deeplethe/utopia with its own CNPG database and data
# disk, behind an oauth2-proxy Google sign-in of its own. An application beside
# Lore, not a dependency of it: leaving this false changes nothing about Lore.
variable "enable_utopia" {
  description = "Keep Utopia's Secret Manager entries; the app itself runs on the internal cluster from re-cinq/utopia."
  type        = bool
  default     = false
}

variable "enable_utopia_auto_setup" {
  description = "Let lore-api create a repo's Utopia knowledge base on the repo's first spec/ADR ingest, with the write token in GSM lore-utopia-lore-api-token (docs/managing-secrets.md). Needs a Utopia that takes a write token on its setup routes (deeplethe/utopia#1244); keep it off until that is deployed."
  type        = bool
  default     = false

  validation {
    condition     = !var.enable_utopia_auto_setup || (var.enable_utopia && var.utopia_lore_workspace_id != "")
    error_message = "enable_utopia_auto_setup = true requires enable_utopia and a non-empty utopia_lore_workspace_id: the bases are created in that Utopia workspace."
  }
}

variable "enable_lore_reviewer" {
  description = "Mirror the lore-reviewer GitHub App's id, private key and installation id (GSM lore-reviewer-app-*) into lore-stations, where the auto-merge loop approves green, reviewed pull requests as it (docs/managing-secrets.md). Turning it on creates the three GSM containers; add their versions after the apply, then force-sync and restart lore-stations."
  type        = bool
  default     = false
}

variable "utopia_lore_workspace_id" {
  description = "The Utopia workspace lore-api creates repos' knowledge bases in, when enable_utopia_auto_setup is true. The token's owner must be its admin."
  type        = string
  default     = ""
}

