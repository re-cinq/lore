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

# ── ObjectStore (barman-cloud plugin) ───────────────────────────────

resource "kubectl_manifest" "lore_db_objectstore" {
  yaml_body = yamlencode({
    apiVersion = "barmancloud.cnpg.io/v1"
    kind       = "ObjectStore"
    metadata = {
      name      = "lore-db-backup"
      namespace = "lore-db"
    }
    spec = {
      configuration = {
        destinationPath = "gs://${google_storage_bucket.db_backups.name}/lore-db"
        googleCredentials = {
          gkeEnvironment = true
        }
      }
      retentionPolicy = "7d"
    }
  })

  depends_on = [kubernetes_namespace.lore_db]
}

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
      username = "lore"
      password = data.google_secret_manager_secret_version.db_password.secret_data
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
          # `lore` owns the database, so the ui-helm migrate hook can run DDL as
          # `lore` without superuser. CNPG creates this role from the secret
          # below (username: lore); enableSuperuserAccess stays at the secure
          # default (false). CREATE EXTENSION is the only superuser step and runs
          # once here at bootstrap, not per-migration.
          owner = "lore"
          secret = {
            name = "lore-db-credentials"
          }
          postInitSQL = [
            "CREATE EXTENSION IF NOT EXISTS vector",
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

      plugins = [{
        name          = "barman-cloud.cloudnative-pg.io"
        isWALArchiver = true
        parameters = {
          barmanObjectName = "lore-db-backup"
        }
      }]

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
    }
  })

  wait_for_rollout = false

  depends_on = [
    kubernetes_namespace.lore_db,
    kubectl_manifest.lore_db_credentials,
    kubectl_manifest.lore_db_objectstore,
  ]
}

# ── Operational add-ons (ownership reconciler) ─────────────────────
#
# The `pre-install,pre-upgrade` hook Job that re-aligns `pipeline.*` ownership
# with the `lore` role now ships in the umbrella Helm release
# (`helm_release.lore_platform` in lore-platform.tf), under the `lore-db-helm`
# subchart key (cluster.name = "lore-db"). That release depends_on
# `kubectl_manifest.lore_db_cluster` so the CNPG primary exists first.

# ── Scheduled backup (plugin method) ───────────────────────────────

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
      method = "plugin"
      pluginConfiguration = {
        name = "barman-cloud.cloudnative-pg.io"
      }
    }
  })

  depends_on = [kubectl_manifest.lore_db_cluster]
}
