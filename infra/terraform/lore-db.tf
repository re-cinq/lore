# ---------------------------------------------------------------------------
# PostgreSQL (CNPG) — database, backup plugin, scheduled backup
#
# The CNPG operator runs in the n8n namespace (shared). This file manages:
#   - lore-db namespace
#   - CNPG Cluster CR (PostgreSQL 16 + pgvector)
#   - ObjectStore CR (GCS via Workload Identity, barman-cloud plugin)
#   - GCS backup bucket + service account + Workload Identity
#   - ScheduledBackup CR (daily 2AM, 7d retention, plugin method)
#
# The barman-cloud plugin is installed manually in the operator namespace:
#   curl -sL https://github.com/cloudnative-pg/plugin-barman-cloud/releases/download/v0.11.0/manifest.yaml | \
#     sed 's/namespace: cnpg-system/namespace: n8n/g' | kubectl apply -f -
# ---------------------------------------------------------------------------

# ── Database password ───────────────────────────────────────────────
#
# Read, never written. The live value is whatever GCP Secret Manager holds
# right now, so a rotation (`gcloud secrets versions add lore-db-password`)
# reaches this Secret on the next apply without anyone's tfvars being involved.
# The container itself is declared in secrets.tf.

data "google_secret_manager_secret_version" "db_password" {
  secret = google_secret_manager_secret.lore["lore-db-password"].secret_id
}

# ── Namespace ───────────────────────────────────────────────────────

# ── Backup infrastructure ───────────────────────────────────────────

resource "google_storage_bucket" "db_backups" {
  name                        = "lore-db-backups-${var.project_id}"
  project                     = var.project_id
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_service_account" "db_backup" {
  account_id   = "lore-db-backup"
  display_name = "Lore DB Backup (CNPG)"
  project      = var.project_id
}

resource "google_storage_bucket_iam_member" "db_backup_admin" {
  bucket = google_storage_bucket.db_backups.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.db_backup.email}"
}

resource "google_storage_bucket_iam_member" "db_backup_reader" {
  bucket = google_storage_bucket.db_backups.name
  role   = "roles/storage.legacyBucketReader"
  member = "serviceAccount:${google_service_account.db_backup.email}"
}

resource "google_service_account_iam_member" "db_backup_wi" {
  service_account_id = google_service_account.db_backup.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[lore-db/lore-db]"
}

# ── ObjectStore (barman-cloud plugin) ───────────────────────────────

