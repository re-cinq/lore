# --------------------------------------------------------------------------
# Cloud SQL (PostgreSQL 15) for Langfuse
# --------------------------------------------------------------------------

# ----- Database password from Secret Manager -----

resource "google_secret_manager_secret" "langfuse_db_password" {
  secret_id = "langfuse-db-password"
  project   = var.project_id

  replication {
    auto {}
  }
}

resource "random_password" "langfuse_db" {
  length  = 32
  special = false
}

resource "google_secret_manager_secret_version" "langfuse_db_password" {
  secret      = google_secret_manager_secret.langfuse_db_password.id
  secret_data = random_password.langfuse_db.result
}

# ----- Private IP range for Cloud SQL -----

resource "google_compute_global_address" "cloud_sql_private_ip" {
  name          = "langfuse-sql-private-ip-range"
  project       = var.project_id
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = var.network_id
}

resource "google_service_networking_connection" "cloud_sql_vpc_connection" {
  network                 = var.network_id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.cloud_sql_private_ip.name]
}

# ----- Cloud SQL Instance -----

resource "google_sql_database_instance" "langfuse" {
  name             = "langfuse-postgres"
  project          = var.project_id
  region           = var.region
  database_version = "POSTGRES_15"

  settings {
    tier              = "db-g1-small"
    availability_type = "ZONAL"

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.network_id
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
    }
  }

  deletion_protection = true

  depends_on = [google_service_networking_connection.cloud_sql_vpc_connection]

  lifecycle {
    prevent_destroy = true
  }
}

# ----- Database -----

resource "google_sql_database" "langfuse" {
  name     = "langfuse"
  project  = var.project_id
  instance = google_sql_database_instance.langfuse.name
}

# ----- Database User -----

resource "google_sql_user" "langfuse" {
  name     = "langfuse"
  project  = var.project_id
  instance = google_sql_database_instance.langfuse.name
  password = random_password.langfuse_db.result
}
