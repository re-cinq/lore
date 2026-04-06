# --------------------------------------------------------------------------
# PostgreSQL (CNPG) on GKE via the CloudNativePG Kubernetes Operator
#
# Replaces managed AlloyDB/Cloud SQL with self-hosted PostgreSQL running
# as a pod on the existing GKE cluster. Uses the CNPG operator for HA,
# failover, and GCS backups via the barman-cloud plugin.
#
# Backup: barman-cloud plugin (barmanObjectStore was deprecated in CNPG 1.25,
# removed in 1.29). The ObjectStore CR lives in the lore-db namespace.
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
    helm = {
      source  = "hashicorp/helm"
      version = ">= 2.13"
    }
    kubectl = {
      source  = "alekc/kubectl"
      version = ">= 2.0"
    }
  }
}

# ----- Namespaces -----

resource "kubernetes_namespace" "lore_db" {
  metadata {
    name = "lore-db"
  }
}

resource "kubernetes_namespace" "cnpg_system" {
  metadata {
    name = "cnpg-system"
  }
}

# ----- CNPG Operator -----

resource "helm_release" "cnpg_operator" {
  name             = "cnpg"
  repository       = "https://cloudnative-pg.github.io/charts"
  chart            = "cloudnative-pg"
  namespace        = kubernetes_namespace.cnpg_system.metadata[0].name
  create_namespace = false
  wait             = true
  timeout          = 300
}

# ----- Barman-cloud backup plugin -----
# Migrated from deprecated barmanObjectStore (CNPG ≥ 1.25 deprecation,
# removed in 1.29). The plugin handles WAL archiving and base backups to GCS.

resource "helm_release" "cnpg_barman_plugin" {
  name             = "cnpg-barman-cloud"
  repository       = "https://cloudnative-pg.github.io/charts"
  chart            = "barman-cloud"
  namespace        = kubernetes_namespace.cnpg_system.metadata[0].name
  create_namespace = false
  wait             = true
  timeout          = 120

  depends_on = [helm_release.cnpg_operator]
}

# ----- Database credentials secret (CNPG bootstrap) -----

resource "kubernetes_secret" "lore_db_credentials" {
  metadata {
    name      = "lore-db-credentials"
    namespace = kubernetes_namespace.lore_db.metadata[0].name
  }

  type = "kubernetes.io/basic-auth"

  data = {
    username = "postgres"
    password = var.db_password
  }
}

# Legacy secret name consumed by lore-agent and lore-mcp deployments.
resource "kubernetes_secret" "lore_db_password" {
  metadata {
    name      = "lore-db-password"
    namespace = kubernetes_namespace.lore_db.metadata[0].name
  }

  data = {
    password = var.db_password
  }
}

# ----- GCS Backup bucket -----

resource "google_storage_bucket" "lore_db_backups" {
  name          = "lore-db-backups-${var.project_id}"
  location      = upper(var.region)
  project       = var.project_id
  force_destroy = false

  uniform_bucket_level_access = true

  lifecycle_rule {
    condition {
      age = var.backup_retention_days
    }
    action {
      type = "Delete"
    }
  }
}

# ----- Backup GCP Service Account -----

resource "google_service_account" "lore_db_backup" {
  account_id   = "lore-db-backup"
  display_name = "CNPG Backup SA — lore-db GCS backups via Workload Identity"
  project      = var.project_id
}

resource "google_project_iam_member" "lore_db_backup_storage_admin" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.lore_db_backup.email}"
}

resource "google_project_iam_member" "lore_db_backup_bucket_reader" {
  project = var.project_id
  role    = "roles/storage.legacyBucketReader"
  member  = "serviceAccount:${google_service_account.lore_db_backup.email}"
}

# Workload Identity binding: CNPG creates a k8s SA named after the cluster
# (lore-db) in the lore-db namespace. The Cluster spec annotates it via
# serviceAccountTemplate so GKE grants GCS access without a key file.
resource "google_service_account_iam_member" "lore_db_backup_workload_identity" {
  service_account_id = google_service_account.lore_db_backup.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[lore-db/lore-db]"
}

# ----- barman-cloud ObjectStore -----
# Replaces the inline barmanObjectStore block that was deprecated in CNPG 1.25.
# The Cluster references this CR via spec.plugins[].parameters.barmanObjectName.

resource "kubectl_manifest" "lore_db_object_store" {
  yaml_body = <<-YAML
    apiVersion: barmancloud.cnpg.io/v1
    kind: ObjectStore
    metadata:
      name: lore-db-backup-store
      namespace: lore-db
    spec:
      configuration:
        destinationPath: gs://lore-db-backups-${var.project_id}/cnpg
        googleCredentials:
          gkeEnvironment: true
        wal:
          compression: gzip
        data:
          compression: gzip
          immediateCheckpoint: false
  YAML

  depends_on = [
    helm_release.cnpg_barman_plugin,
    kubernetes_namespace.lore_db,
  ]
}

# ----- CNPG Cluster -----

resource "kubectl_manifest" "lore_db_cluster" {
  yaml_body = <<-YAML
    apiVersion: postgresql.cnpg.io/v1
    kind: Cluster
    metadata:
      name: lore-db
      namespace: lore-db
    spec:
      instances: 1
      imageName: ghcr.io/cloudnative-pg/postgresql:16-bookworm

      # Annotate the CNPG-managed service account so GKE Workload Identity
      # can impersonate the lore-db-backup GCP SA for GCS access.
      serviceAccountTemplate:
        metadata:
          annotations:
            iam.gke.io/gcp-service-account: ${google_service_account.lore_db_backup.email}

      bootstrap:
        initdb:
          database: lore
          owner: postgres
          secret:
            name: lore-db-credentials
          postInitSQL:
            - CREATE EXTENSION IF NOT EXISTS vector

      # --- Restore procedure (uncomment to recover from a backup) -----------
      # Replace the bootstrap.initdb block above with this block.
      # Point externalClusters.name to the ObjectStore CR holding the backup.
      #
      # bootstrap:
      #   recovery:
      #     source: lore-db-backup-store
      #
      # externalClusters:
      #   - name: lore-db-backup-store
      #     plugin:
      #       name: barman-cloud.cloudnative-pg.io
      #       parameters:
      #         barmanObjectName: lore-db-backup-store
      # ----------------------------------------------------------------------

      storage:
        size: ${var.disk_size}
        storageClass: ${var.storage_class}

      resources:
        requests:
          cpu: "500m"
          memory: "1Gi"
        limits:
          cpu: "${var.cpu}"
          memory: "${var.memory}"

      postgresql:
        shared_preload_libraries:
          - vector

      # barman-cloud plugin handles WAL archiving and base backups.
      plugins:
        - name: barman-cloud.cloudnative-pg.io
          isWALArchiver: true
          parameters:
            barmanObjectName: lore-db-backup-store
  YAML

  depends_on = [
    helm_release.cnpg_operator,
    kubernetes_secret.lore_db_credentials,
    kubectl_manifest.lore_db_object_store,
    google_service_account_iam_member.lore_db_backup_workload_identity,
  ]
}

# ----- ScheduledBackup -----
# Daily at 02:00 UTC, 7-day retention enforced by the GCS lifecycle rule above.
# method: plugin replaces deprecated method: barmanObjectStore.

resource "kubectl_manifest" "lore_db_scheduled_backup" {
  yaml_body = <<-YAML
    apiVersion: postgresql.cnpg.io/v1
    kind: ScheduledBackup
    metadata:
      name: lore-db-daily
      namespace: lore-db
    spec:
      schedule: "0 0 2 * * *"
      backupOwnerReference: self
      method: plugin
      pluginConfiguration:
        name: barman-cloud.cloudnative-pg.io
        parameters:
          barmanObjectName: lore-db-backup-store
      cluster:
        name: lore-db
  YAML

  depends_on = [kubectl_manifest.lore_db_cluster]
}
