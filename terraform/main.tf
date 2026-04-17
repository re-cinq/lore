terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.13"
    }
    kubectl = {
      source  = "alekc/kubectl"
      version = "~> 2.0"
    }
  }

  backend "gcs" {
    bucket = "re5-n8n-terraform-state"
    prefix = "lore"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_container_cluster" "cluster" {
  name     = var.cluster_name
  location = var.region
}

data "google_client_config" "default" {}

provider "kubernetes" {
  host                   = "https://${data.google_container_cluster.cluster.endpoint}"
  token                  = data.google_client_config.default.access_token
  cluster_ca_certificate = base64decode(data.google_container_cluster.cluster.master_auth[0].cluster_ca_certificate)
}

provider "helm" {
  kubernetes {
    host                   = "https://${data.google_container_cluster.cluster.endpoint}"
    token                  = data.google_client_config.default.access_token
    cluster_ca_certificate = base64decode(data.google_container_cluster.cluster.master_auth[0].cluster_ca_certificate)
  }
}

provider "kubectl" {
  host                   = "https://${data.google_container_cluster.cluster.endpoint}"
  token                  = data.google_client_config.default.access_token
  cluster_ca_certificate = base64decode(data.google_container_cluster.cluster.master_auth[0].cluster_ca_certificate)
  load_config_file       = false
}

# --- Namespaces ---

resource "kubernetes_namespace" "mcp_servers" {
  metadata { name = "mcp-servers" }
}

resource "kubernetes_namespace" "lore_agent" {
  metadata { name = "lore-agent" }
}

resource "kubernetes_namespace" "lore_ui" {
  metadata { name = "lore-ui" }
}
