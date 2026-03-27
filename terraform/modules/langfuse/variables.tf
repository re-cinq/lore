# --------------------------------------------------------------------------
# Variables for the Langfuse module
# --------------------------------------------------------------------------

variable "project_id" {
  description = "GCP project ID where Langfuse resources are created."
  type        = string
}

variable "cluster_name" {
  description = "Name of the GKE cluster where Langfuse will be deployed."
  type        = string
}

variable "region" {
  description = "GCP region for all resources."
  type        = string
  default     = "europe-west4"
}

variable "network_id" {
  description = "Fully-qualified self_link of the VPC network for private IP access."
  type        = string
}

variable "google_client_id" {
  description = "Google Workspace OAuth client ID for OIDC authentication."
  type        = string
  sensitive   = true
}

variable "google_client_secret" {
  description = "Google Workspace OAuth client secret for OIDC authentication."
  type        = string
  sensitive   = true
}

variable "cloud_sql_connection_name" {
  description = "Cloud SQL instance connection name (project:region:instance). If empty, the module creates its own Cloud SQL instance."
  type        = string
  default     = ""
}

variable "langfuse_domain" {
  description = "Public domain for the Langfuse UI (used for NEXTAUTH_URL)."
  type        = string
  default     = "langfuse.lore.internal"
}
