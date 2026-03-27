# --------------------------------------------------------------------------
# BigQuery dataset + Cloud Storage bucket for Langfuse traces & media
# --------------------------------------------------------------------------

# ----- Langfuse GKE Service Account -----

resource "google_service_account" "langfuse" {
  account_id   = "langfuse-server"
  display_name = "Langfuse Server (GKE Workload Identity)"
  project      = var.project_id
}

# ----- BigQuery Dataset -----

resource "google_bigquery_dataset" "traces" {
  dataset_id = "lore_platform_traces"
  project    = var.project_id
  location   = "EU"

  friendly_name = "Platform Traces"
  description   = "Langfuse trace exports and analytics data."

  labels = {
    managed-by = "terraform"
    component  = "langfuse"
  }
}

resource "google_bigquery_dataset_iam_member" "langfuse_data_editor" {
  dataset_id = google_bigquery_dataset.traces.dataset_id
  project    = var.project_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.langfuse.email}"
}

# ----- Cloud Storage Bucket -----

resource "google_storage_bucket" "langfuse_media" {
  name     = "lore-langfuse-media"
  project  = var.project_id
  location = var.region

  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  labels = {
    managed-by = "terraform"
    component  = "langfuse"
  }
}

resource "google_storage_bucket_iam_member" "langfuse_object_admin" {
  bucket = google_storage_bucket.langfuse_media.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.langfuse.email}"
}

# ----- Workload Identity binding -----

resource "google_service_account_iam_member" "langfuse_workload_identity" {
  service_account_id = google_service_account.langfuse.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[langfuse/langfuse]"
}
