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
    bucket = "acme-terraform-state"
    prefix = "lore-platform"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  type        = string
  description = "GCP project ID"
}

variable "region" {
  type    = string
  default = "europe-west4"
}

variable "network_id" {
  type        = string
  description = "VPC network self_link"
}

variable "subnetwork_id" {
  type        = string
  description = "Subnet self_link for GKE nodes"
}

module "alloydb" {
  source     = "./modules/alloydb"
  project_id = var.project_id
  region     = var.region
  network_id = var.network_id
}

module "gke" {
  source        = "./modules/gke-mcp"
  project_id    = var.project_id
  region        = var.region
  network_id    = var.network_id
  subnetwork_id = var.subnetwork_id
}

module "langfuse" {
  source                    = "./modules/langfuse"
  project_id                = var.project_id
  region                    = var.region
  cluster_name              = module.gke.cluster_name
  google_client_id          = var.google_client_id
  google_client_secret      = var.google_client_secret
  cloud_sql_connection_name = module.langfuse.connection_name
}

variable "google_client_id" {
  type      = string
  sensitive = true
}

variable "google_client_secret" {
  type      = string
  sensitive = true
}
