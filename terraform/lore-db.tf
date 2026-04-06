# ---------------------------------------------------------------------------
# PostgreSQL (CNPG) — database, backup, plugin, scheduled backup
#
# The CNPG operator is shared with the n8n namespace (installed separately).
# This file manages:
#   - lore-db namespace
#   - CNPG Cluster CR (PostgreSQL + pgvector)
#   - Barman Cloud plugin for backups
#   - GCS backup bucket + service account + Workload Identity
#   - ScheduledBackup CR (daily, 7d retention)
#   - ObjectStore CR (GCS via Workload Identity)
# ---------------------------------------------------------------------------

# ── Namespace ───────────────────────────────────────────────────────

resource "kubernetes_namespace" "lore_db" {
  metadata {
    name = "lore-db"
  }
}

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

# ── Barman Cloud plugin (manual install) ────────────────────────────
# The barman-cloud plugin is installed manually because the upstream
# manifest contains CRDs, RBAC, certs, and a deployment that can't
# be managed as a single Terraform resource.
#
# Install/upgrade:
#   kubectl apply -f https://github.com/cloudnative-pg/plugin-barman-cloud/releases/download/v0.11.0/manifest.yaml
#
# Once installed, migrate from barman to plugin by:
# 1. Creating an ObjectStore CR (barmancloud.cnpg.io/v1)
# 2. Updating the Cluster spec to use plugins instead of backup.barmanObjectStore
# 3. Updating ScheduledBackup to method: plugin
# See: https://cloudnative-pg.io/plugin-barman-cloud/docs/next/migration/

# ── CNPG Cluster ────────────────────────────────────────────────────

resource "kubectl_manifest" "lore_db_credentials" {
  yaml_body = yamlencode({
    apiVersion = "v1"
    kind       = "Secret"
    metadata = {
      name      = "lore-db-credentials"
      namespace = "lore-db"
    }
    type = "kubernetes.io/basic-auth"
    stringData = {
      username = "postgres"
      password = var.db_password
    }
  })

  depends_on = [kubernetes_namespace.lore_db]
}

resource "kubectl_manifest" "lore_db_cluster" {
  yaml_body = yamlencode({
    apiVersion = "postgresql.cnpg.io/v1"
    kind       = "Cluster"
    metadata = {
      name      = "lore-db"
      namespace = "lore-db"
    }
    spec = {
      instances = 1
      imageName = "ghcr.io/cloudnative-pg/postgresql:16-bookworm"

      bootstrap = {
        initdb = {
          database = "lore"
          owner    = "postgres"
          secret = {
            name = "lore-db-credentials"
          }
          postInitSQL = [
            "CREATE EXTENSION IF NOT EXISTS vector",
            "CREATE ROLE lore LOGIN PASSWORD '${var.db_password}'",
          ]
        }
      }

      # To restore from backup instead of initdb, replace bootstrap with:
      # bootstrap = {
      #   recovery = {
      #     source = "lore-db-backup"
      #   }
      # }
      # externalClusters = [{
      #   name = "lore-db-backup"
      #   plugin = {
      #     name = "barman-cloud.cloudnative-pg.io"
      #     parameters = {
      #       barmanObjectName = "lore-db-backup"
      #       serverName       = "lore-db"
      #     }
      #   }
      # }]

      serviceAccountTemplate = {
        metadata = {
          annotations = {
            "iam.gke.io/gcp-service-account" = google_service_account.db_backup.email
          }
        }
      }

      storage = {
        size = "50Gi"
      }

      resources = {
        requests = {
          cpu    = "500m"
          memory = "1Gi"
        }
        limits = {
          cpu    = "2"
          memory = "4Gi"
        }
      }

      postgresql = {
        shared_preload_libraries = ["vector"]
      }

      backup = {
        barmanObjectStore = {
          destinationPath = "gs://${google_storage_bucket.db_backups.name}/lore-db"
          googleCredentials = {
            gkeEnvironment = true
          }
        }
        retentionPolicy = "7d"
      }
    }
  })

  wait_for_rollout = false

  depends_on = [
    kubernetes_namespace.lore_db,
    kubectl_manifest.lore_db_credentials,
  ]
}

# ── Scheduled backup ────────────────────────────────────────────────

resource "kubectl_manifest" "lore_db_scheduled_backup" {
  yaml_body = yamlencode({
    apiVersion = "postgresql.cnpg.io/v1"
    kind       = "ScheduledBackup"
    metadata = {
      name      = "lore-db-daily"
      namespace = "lore-db"
    }
    spec = {
      schedule             = "0 0 2 * * *"
      backupOwnerReference = "self"
      cluster = {
        name = "lore-db"
      }
      method = "barmanObjectStore"
    }
  })

  depends_on = [kubectl_manifest.lore_db_cluster]
}
