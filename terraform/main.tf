terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.25"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
  }

  backend "gcs" {
    bucket = "lore-terraform-state"
    prefix = "lore-platform"
  }
}

locals {
  project_id   = "re5-n8n-platform"
  region       = "europe-west1"
  cluster_name = "n8n-cluster"
  network      = "default"
}

provider "google" {
  project = local.project_id
  region  = local.region
}

provider "google-beta" {
  project = local.project_id
  region  = local.region
}

# Connect to existing GKE cluster
data "google_container_cluster" "existing" {
  name     = local.cluster_name
  location = local.region
  project  = local.project_id
}

provider "kubernetes" {
  host                   = "https://${data.google_container_cluster.existing.endpoint}"
  token                  = data.google_client_config.default.access_token
  cluster_ca_certificate = base64decode(data.google_container_cluster.existing.master_auth[0].cluster_ca_certificate)
}

provider "helm" {
  kubernetes {
    host                   = "https://${data.google_container_cluster.existing.endpoint}"
    token                  = data.google_client_config.default.access_token
    cluster_ca_certificate = base64decode(data.google_container_cluster.existing.master_auth[0].cluster_ca_certificate)
  }
}

data "google_client_config" "default" {}

# --- Namespaces in existing cluster ------------------------------------------

resource "kubernetes_namespace" "mcp_servers" {
  metadata { name = "mcp-servers" }
}

resource "kubernetes_namespace" "klaus" {
  metadata { name = "klaus" }
}

resource "kubernetes_namespace" "graphiti" {
  metadata { name = "graphiti" }
}

# --- PostgreSQL (CNPG) ------------------------------------------------------------

module "lore-db" {
  source      = "./modules/lore-db"
  project_id  = local.project_id
  region      = local.region
  db_password = var.lore_db_password
}

variable "lore_db_password" {
  type      = string
  sensitive = true
}

# --- Observability is OpenTelemetry → Cloud Monitoring (no separate service) --
# OTEL instrumentation is in the MCP server code, not Terraform.
# Cloud Monitoring is available by default on GCP — no resources to create.
