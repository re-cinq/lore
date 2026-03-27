variable "project_id" {
  description = "GCP project ID (used for Vertex AI integration)."
  type        = string
}

variable "region" {
  description = "GCP region (must match Vertex AI availability for embedding())."
  type        = string
  default     = "europe-west1"
}

variable "db_password" {
  description = "Admin password for the PostgreSQL (CNPG) instance."
  type        = string
  sensitive   = true
}

variable "cpu" {
  description = "CPU count for the PostgreSQL (CNPG) primary instance."
  type        = number
  default     = 2
}

variable "memory" {
  description = "Memory for the PostgreSQL (CNPG) primary instance."
  type        = string
  default     = "16Gi"
}

variable "disk_size" {
  description = "Persistent disk size for data."
  type        = string
  default     = "50Gi"
}

variable "storage_class" {
  description = "Kubernetes storage class for the data disk."
  type        = string
  default     = "standard-rwo"
}
