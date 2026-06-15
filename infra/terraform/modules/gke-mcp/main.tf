# --------------------------------------------------------------------------
# GKE cluster (lore-ai-platform) — private, regional, Workload Identity
# --------------------------------------------------------------------------

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.25"
    }
  }
}

# ----- GKE Cluster -----

resource "google_container_cluster" "main" {
  name     = "lore-ai-platform"
  project  = var.project_id
  location = var.region

  network    = var.network_id
  subnetwork = var.subnetwork_id

  # Use a separately managed node pool — remove default pool immediately.
  remove_default_node_pool = true
  initial_node_count       = 1

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  release_channel {
    channel = "REGULAR"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# ----- Node Pool: mcp-pool (MCP servers) -----

resource "google_container_node_pool" "mcp_pool" {
  name     = "mcp-pool"
  project  = var.project_id
  location = var.region
  cluster  = google_container_cluster.main.name

  autoscaling {
    min_node_count = 2
    max_node_count = 6
  }

  node_config {
    machine_type    = "n2-standard-4"
    service_account = google_service_account.gke_nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    labels = {
      pool = "mcp"
    }
  }
}

# ----- Node Pool: general (Langfuse, Klaus, supporting services) -----

resource "google_container_node_pool" "general" {
  name     = "general"
  project  = var.project_id
  location = var.region
  cluster  = google_container_cluster.main.name

  autoscaling {
    min_node_count = 2
    max_node_count = 8
  }

  node_config {
    machine_type    = "n2-standard-2"
    service_account = google_service_account.gke_nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    labels = {
      pool = "general"
    }
  }
}

# ----- GKE Node Service Account -----

resource "google_service_account" "gke_nodes" {
  account_id   = "lore-gke-nodes"
  display_name = "GKE Node Service Account for lore-ai-platform"
  project      = var.project_id
}

resource "google_project_iam_member" "gke_nodes_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.gke_nodes.email}"
}

resource "google_project_iam_member" "gke_nodes_metric_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.gke_nodes.email}"
}

resource "google_project_iam_member" "gke_nodes_monitoring_viewer" {
  project = var.project_id
  role    = "roles/monitoring.viewer"
  member  = "serviceAccount:${google_service_account.gke_nodes.email}"
}

# ----- Kubernetes Provider (configured from cluster) -----

data "google_client_config" "default" {}

provider "kubernetes" {
  host                   = "https://${google_container_cluster.main.endpoint}"
  token                  = data.google_client_config.default.access_token
  cluster_ca_certificate = base64decode(google_container_cluster.main.master_auth[0].cluster_ca_certificate)
}

# ----- Kubernetes Namespaces -----

resource "kubernetes_namespace" "mcp_servers" {
  metadata {
    name = "mcp-servers"

    labels = {
      managed-by = "terraform"
      component  = "mcp"
    }
  }

  depends_on = [
    google_container_node_pool.mcp_pool,
    google_container_node_pool.general,
  ]
}

resource "kubernetes_namespace" "langfuse" {
  metadata {
    name = "langfuse"

    labels = {
      managed-by = "terraform"
      component  = "observability"
    }
  }

  depends_on = [
    google_container_node_pool.mcp_pool,
    google_container_node_pool.general,
  ]
}

resource "kubernetes_namespace" "klaus" {
  metadata {
    name = "klaus"

    labels = {
      managed-by = "terraform"
      component  = "agents"
    }
  }

  depends_on = [
    google_container_node_pool.mcp_pool,
    google_container_node_pool.general,
  ]
}
