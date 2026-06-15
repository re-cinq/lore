variable "project_id" {
  description = "GCP project ID where GKE and related resources are created."
  type        = string
}

variable "region" {
  description = "GCP region for the GKE cluster."
  type        = string
  default     = "europe-west4"
}

variable "network_id" {
  description = "Fully-qualified self_link of the VPC network (e.g. projects/<project>/global/networks/<name>)."
  type        = string
}

variable "subnetwork_id" {
  description = "Fully-qualified self_link of the VPC subnetwork for GKE nodes."
  type        = string
}

variable "lore_mcp_endpoint" {
  description = "HTTPS endpoint of the Lore MCP server for Cloud Scheduler jobs (e.g. https://mcp.internal.lore.dev)."
  type        = string
}

variable "lore_agent_token_secret_id" {
  description = "Secret Manager secret ID containing the bearer token for authenticated Cloud Scheduler requests to the Lore MCP endpoint."
  type        = string
}
