# --------------------------------------------------------------------------
# Langfuse Helm release on GKE with Cloud SQL Auth Proxy sidecar
# --------------------------------------------------------------------------

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = ">= 2.12"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.5"
    }
  }
}

# ----- Resolve the Cloud SQL connection name -----

locals {
  cloud_sql_connection = (
    var.cloud_sql_connection_name != ""
    ? var.cloud_sql_connection_name
    : "${var.project_id}:${var.region}:${google_sql_database_instance.langfuse.name}"
  )

  database_url = "postgresql://${google_sql_user.langfuse.name}:${random_password.langfuse_db.result}@127.0.0.1:5432/${google_sql_database.langfuse.name}"
}

# ----- NEXTAUTH_SECRET (random, stored in Secret Manager) -----

resource "random_password" "nextauth_secret" {
  length  = 64
  special = false
}

resource "google_secret_manager_secret" "nextauth_secret" {
  secret_id = "langfuse-nextauth-secret"
  project   = var.project_id

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "nextauth_secret" {
  secret      = google_secret_manager_secret.nextauth_secret.id
  secret_data = random_password.nextauth_secret.result
}

# ----- Helm Release -----

resource "helm_release" "langfuse" {
  name       = "langfuse"
  repository = "https://langfuse.github.io/langfuse-k8s"
  chart      = "langfuse"
  namespace  = "langfuse"
  version    = "1.2.0"

  create_namespace = false # namespace managed by gke-mcp module

  # ----- Core configuration -----

  set {
    name  = "langfuse.nextauth.url"
    value = "https://${var.langfuse_domain}"
  }

  set_sensitive {
    name  = "langfuse.nextauth.secret"
    value = random_password.nextauth_secret.result
  }

  # ----- Database (via Cloud SQL Auth Proxy at 127.0.0.1:5432) -----

  set_sensitive {
    name  = "langfuse.database.url"
    value = local.database_url
  }

  # ----- OIDC / Google Workspace -----

  set {
    name  = "langfuse.auth.google.enabled"
    value = "true"
  }

  set_sensitive {
    name  = "langfuse.auth.google.clientId"
    value = var.google_client_id
  }

  set_sensitive {
    name  = "langfuse.auth.google.clientSecret"
    value = var.google_client_secret
  }

  # ----- Service Account for Workload Identity -----

  set {
    name  = "serviceAccount.create"
    value = "true"
  }

  set {
    name  = "serviceAccount.name"
    value = "langfuse"
  }

  set {
    name  = "serviceAccount.annotations.iam\\.gke\\.io/gcp-service-account"
    value = google_service_account.langfuse.email
  }

  # ----- Cloud SQL Auth Proxy sidecar (annotation-based) -----

  set {
    name  = "podAnnotations.cloud-sql-proxy\\.cloud\\.google\\.com/enabled"
    value = "true"
  }

  set {
    name  = "podAnnotations.cloud-sql-proxy\\.cloud\\.google\\.com/instance-connection-name"
    value = local.cloud_sql_connection
  }

  set {
    name  = "podAnnotations.cloud-sql-proxy\\.cloud\\.google\\.com/port"
    value = "5432"
  }

  # ----- Node selection -----

  set {
    name  = "nodeSelector.pool"
    value = "general"
  }

  depends_on = [
    google_sql_database.langfuse,
    google_sql_user.langfuse,
    google_service_account_iam_member.langfuse_workload_identity,
  ]
}
