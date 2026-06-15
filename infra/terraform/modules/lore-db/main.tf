# --------------------------------------------------------------------------
# PostgreSQL (CNPG) on GKE via the PostgreSQL (CNPG) Kubernetes Operator
#
# Replaces managed PostgreSQL (CNPG) Enterprise (~$300/month) with the free
# self-hosted PostgreSQL (CNPG) running as a pod on the existing GKE cluster.
# Same ScaNN index, same embedding() function, same SQL interface.
#
# NOTE: The operator and DBCluster are installed via the setup script
# (scripts/infra/setup-db.sh) because:
# 1. The OCI registry needs gcloud auth that Terraform Helm provider can't do
# 2. The DBCluster CRD doesn't exist until the operator is installed
# --------------------------------------------------------------------------

terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.25"
    }
  }
}

# ----- Namespace -----

resource "kubernetes_namespace" "lore-db" {
  metadata {
    name = "lore-db"
  }
}

# ----- Database password secret -----

resource "kubernetes_secret" "lore_db_password" {
  metadata {
    name      = "lore-db-password"
    namespace = kubernetes_namespace.lore-db.metadata[0].name
  }

  data = {
    "lore-db-password" = var.db_password
  }
}
