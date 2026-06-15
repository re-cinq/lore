# --------------------------------------------------------------------------
# Langfuse Helm release on GKE with Cloud SQL for external Postgres
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

# ----- Random secrets -----

resource "random_password" "nextauth_secret" {
  length  = 64
  special = false
}

resource "random_password" "salt" {
  length  = 32
  special = false
}

resource "random_password" "encryption_key" {
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

  create_namespace = false

  values = [yamlencode({
    langfuse = {
      nextauth = {
        url = "https://${var.langfuse_domain}"
        secret = {
          value = random_password.nextauth_secret.result
        }
      }
      salt = {
        value = random_password.salt.result
      }
      encryptionKey = {
        value = random_password.encryption_key.result
      }
    }
    postgresql = {
      deploy = true
      auth = {
        password = random_password.langfuse_db.result
      }
    }
    clickhouse = {
      deploy = true
      auth = {
        password = random_password.salt.result
      }
    }
  })]

  timeout = 900 # Langfuse + ClickHouse + Postgres init takes time
}
