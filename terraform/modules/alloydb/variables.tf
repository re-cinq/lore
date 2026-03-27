variable "project_id" {
  description = "GCP project ID where AlloyDB resources are created."
  type        = string
}

variable "region" {
  description = "GCP region for the AlloyDB cluster."
  type        = string
  default     = "europe-west4"
}

variable "network_id" {
  description = "Fully-qualified self_link of the VPC network for private IP access (e.g. projects/<project>/global/networks/<name>)."
  type        = string
}
