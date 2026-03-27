# --------------------------------------------------------------------------
# AlloyDB cluster + primary instance with private networking
# --------------------------------------------------------------------------

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
  }
}

# ----- Private Service Access networking -----

resource "google_compute_global_address" "alloydb_private_ip" {
  name          = "alloydb-private-ip-range"
  project       = var.project_id
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = var.network_id
}

resource "google_service_networking_connection" "alloydb_vpc_connection" {
  network                 = var.network_id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.alloydb_private_ip.name]
}

# ----- AlloyDB Cluster (Enterprise edition) -----

resource "google_alloydb_cluster" "main" {
  cluster_id = "lore-alloydb-cluster"
  project    = var.project_id
  location   = var.region

  database_version = "POSTGRES_15"

  network_config {
    network = var.network_id
  }

  cluster_type = "PRIMARY"

  depends_on = [google_service_networking_connection.alloydb_vpc_connection]

  lifecycle {
    prevent_destroy = true
  }
}

# ----- Primary Instance -----

resource "google_alloydb_instance" "primary" {
  cluster       = google_alloydb_cluster.main.name
  instance_id   = "lore-alloydb-primary"
  instance_type = "PRIMARY"

  machine_config {
    cpu_count = 4 # db-perf-optimized-N-4: 4 vCPU, 32 GB RAM
  }

  depends_on = [google_alloydb_cluster.main]
}
