# ---------------------------------------------------------------------------
# Task Log Storage — KMS, GCS bucket, IAM, Workload Identity
# ---------------------------------------------------------------------------

# --- KMS for encryption at rest ---

resource "google_kms_key_ring" "lore" {
  name     = "lore"
  location = var.region
}

resource "google_kms_crypto_key" "task_logs" {
  name            = "task-logs"
  key_ring        = google_kms_key_ring.lore.id
  rotation_period = "7776000s" # 90 days
}

# --- GCS bucket for task logs ---

resource "google_storage_bucket" "task_logs" {
  name          = "lore-task-logs-${var.project_id}"
  location      = var.region
  storage_class = "STANDARD"

  uniform_bucket_level_access = true

  lifecycle_rule {
    condition {
      age = var.log_retention_days
    }
    action {
      type = "Delete"
    }
  }

  encryption {
    default_kms_key_name = google_kms_crypto_key.task_logs.id
  }

  versioning {
    enabled = false # Logs are append-only, no versioning needed
  }
}

# --- Grant KMS access to the GCS service agent ---

data "google_storage_project_service_account" "gcs_account" {}

resource "google_kms_crypto_key_iam_member" "gcs_encrypt" {
  crypto_key_id = google_kms_crypto_key.task_logs.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${data.google_storage_project_service_account.gcs_account.email_address}"
}

# --- Controller SA: admin access (create + overwrite for live log updates) ---

resource "google_storage_bucket_iam_member" "controller_admin" {
  bucket = google_storage_bucket.task_logs.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.loretask_controller.email}"
}

# --- Web UI SA: read-only access (reads logs for display) ---

resource "google_storage_bucket_iam_member" "ui_read" {
  bucket = google_storage_bucket.task_logs.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.lore_ui.email}"
}

# --- Service accounts for Workload Identity ---

resource "google_service_account" "loretask_controller" {
  account_id   = "loretask-controller"
  display_name = "LoreTask Controller"
}

resource "google_service_account_iam_member" "controller_wi" {
  service_account_id = google_service_account.loretask_controller.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[lore-agent/loretask-controller]"
}

resource "google_service_account" "lore_ui" {
  account_id   = "lore-ui"
  display_name = "Lore Web UI"
}

resource "google_service_account_iam_member" "ui_wi" {
  service_account_id = google_service_account.lore_ui.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[lore-ui/lore-ui]"
}

# --- Lore Agent SA: batch jobs (reindex/ingest) + on-demand task work ---
#
# The agent Deployment and the K8s CronJob batch pods run as KSA
# `lore-agent` in the `lore-agent` namespace (created by the agent Helm
# chart) and impersonate this GCP SA via Workload Identity. Replaces the
# retired Klaus agent SA (ADR-007): the KSA annotation
# (agent-helm/templates/serviceaccount.yaml) points at
# `lore-agent@<project>.iam.gserviceaccount.com`, which previously did not
# exist — so every pod failed to mint a GCP token ("Gaia id not found"),
# breaking Vertex embeddings and GCS log upload. (DB access uses CNPG
# password auth and GitHub uses the App token, so those were unaffected.)

resource "google_service_account" "lore_agent" {
  account_id   = "lore-agent"
  display_name = "Lore Agent — batch reindex/ingest, Vertex embeddings, job logs"
}

# Vertex AI — generate text-embedding-005 embeddings during reindex/ingest.
resource "google_project_iam_member" "lore_agent_aiplatform" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.lore_agent.email}"
}

# GCS task-log bucket — admin (create + overwrite for live log updates),
# mirroring the controller's grant.
resource "google_storage_bucket_iam_member" "lore_agent_logs_admin" {
  bucket = google_storage_bucket.task_logs.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.lore_agent.email}"
}

# Workload Identity: the helm-managed KSA lore-agent/lore-agent impersonates this SA.
resource "google_service_account_iam_member" "lore_agent_wi" {
  service_account_id = google_service_account.lore_agent.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[lore-agent/lore-agent]"
}
