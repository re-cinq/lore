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

# Gates the Headlamp cluster dashboard and its Google sign-in proxy (headlamp.tf).
# The cluster is GKE Autopilot, which cannot run Rancher — Rancher writes into
# kube-system to install, and an Autopilot cluster cannot even be registered into a
# Rancher running elsewhere (rancher/rancher#57604). Headlamp is the read-only
# substitute, and it is a dashboard rather than a dependency: leaving this false
# changes nothing about how the platform runs.
variable "enable_headlamp" {
  type    = bool
  default = false

  # A hostname is not decoration for this feature, it is a dependency: oauth2-proxy
  # builds its Google redirect URL out of it and refuses to start on a malformed
  # one, so `enable_headlamp` with no hostname deploys a pod that cannot boot and
  # fails the apply on the Helm readiness timeout. Rejecting the pair up front beats
  # both that timeout and the quieter alternative of silently deploying nothing.
  validation {
    condition     = !var.enable_headlamp || var.headlamp_hostname != ""
    error_message = "enable_headlamp = true requires a non-empty headlamp_hostname: oauth2-proxy derives its OAuth redirect URL from it and will not start without one."
  }
}

variable "headlamp_hostname" {
  description = "Hostname for the Headlamp dashboard ingress (e.g. headlamp.example.com). Also the OAuth redirect host, so changing it invalidates the Google OAuth client's registered callback. Required when enable_headlamp is true — an empty value is rejected rather than quietly deploying nothing."
  type        = string
  default     = ""
}

# Gates the metrics stack (monitoring.tf): kube-prometheus-stack scraping every
# service, the floor and the agent controller, and Grafana behind the same Google
# sign-in proxy as Headlamp, with the Lore dashboards (ADR-050). A dashboard, not a
# dependency: leaving this false changes nothing about how the platform runs.
variable "enable_monitoring" {
  type    = bool
  default = false

  # The same dependency Headlamp has: oauth2-proxy builds its redirect URL from
  # the hostname and will not start without one.
  validation {
    condition     = !var.enable_monitoring || var.grafana_hostname != ""
    error_message = "enable_monitoring = true requires a non-empty grafana_hostname: oauth2-proxy derives its OAuth redirect URL from it and will not start without one."
  }
}

variable "grafana_hostname" {
  description = "Hostname for the Grafana ingress (e.g. grafana.example.com). Also an OAuth redirect host on the Headlamp Google client, so it must be added to that client's authorized redirect URIs. Required when enable_monitoring is true."
  type        = string
  default     = ""
}

variable "ingress_controller_namespace" {
  description = "The namespace of the nginx ingress controller: the only namespace the Grafana NetworkPolicy lets in, because Grafana trusts the identity header the ingress sets after oauth2-proxy."
  type        = string
  default     = "ingress-nginx"
}

# Gates Utopia (utopia.tf): deeplethe/utopia with its own CNPG database and data
# disk, behind an oauth2-proxy Google sign-in of its own. An application beside
# Lore, not a dependency of it: leaving this false changes nothing about Lore.
variable "enable_utopia" {
  type    = bool
  default = false

  # The same dependency Headlamp has: oauth2-proxy builds its redirect URL from
  # the hostname and will not start without one.
  validation {
    condition     = !var.enable_utopia || var.utopia_hostname != ""
    error_message = "enable_utopia = true requires a non-empty utopia_hostname: oauth2-proxy derives its OAuth redirect URL from it and will not start without one."
  }
}

variable "utopia_hostname" {
  description = "Hostname for the Utopia ingress (e.g. utopia.example.com). Also the OAuth redirect host on the utopia Google client (https://<host>/oauth2/callback). Required when enable_utopia is true."
  type        = string
  default     = ""
}

variable "utopia_image_tag" {
  description = "The ghcr.io/deeplethe/utopia tag to run. Release candidates move fast and migrate the database on start, so a bump is a deliberate PR, never `latest`."
  type        = string
  default     = "0.1.0-rc8"
}

variable "utopia_data_size" {
  description = "Size of the Utopia data disk: uploaded files and the full-text index."
  type        = string
  default     = "20Gi"
}
