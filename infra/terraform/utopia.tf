# ---------------------------------------------------------------------------
# Utopia — deeplethe/utopia, the bitemporal knowledge graph, behind a Google gate.
#
# WHAT IT IS. One Rust binary serving its own React build on :1516, a Postgres 16
# with pgvector it migrates itself as the database owner, and a data directory
# holding uploaded files, the Tantivy full-text index and the key that encrypts
# every stored model credential. Release candidates only (0.1.0-rcN); the tag is
# pinned by var.utopia_image_tag and moves by a deliberate PR.
#
# THE GATE. Utopia's own OIDC never creates an account and never links one by
# email: it only attaches a Google identity to an account a person already made
# (crates/utopia-server/src/api/oidc_routes.rs). So Google cannot be the sign-in on
# its own, and the gate is the same shape as Grafana's (monitoring.tf): oauth2-proxy
# with its own Google client, two Ingresses, re-cinq.com only. Google decides WHO
# gets in; Utopia's own accounts and roles decide what they can do. The first
# account registered inside becomes the administrator; registration stays open
# because only re-cinq accounts reach the form.
#
# WHY ITS OWN DATABASE. CNPG bootstraps one database per Cluster, and Utopia runs
# owner-role DDL on every upgrade. A second small Cluster keeps that away from
# lore-db and its migrate hook; it costs one 250m pod.
# ---------------------------------------------------------------------------

locals {
  utopia_namespace = "utopia"
  utopia_url       = "https://${var.utopia_hostname}"
}

resource "kubernetes_namespace" "utopia" {
  count = var.enable_utopia ? 1 : 0

  metadata { name = local.utopia_namespace }
}

# ---- Database: a one-instance CNPG Cluster, the lore-db recipe without the backups.

data "google_secret_manager_secret_version" "utopia_db_password" {
  count = var.enable_utopia ? 1 : 0

  secret = google_secret_manager_secret.lore["lore-utopia-db-password"].secret_id
}

resource "kubectl_manifest" "utopia_db_credentials" {
  count = var.enable_utopia ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "v1"
    kind       = "Secret"
    metadata = {
      name      = "utopia-db-credentials"
      namespace = local.utopia_namespace
    }
    type = "kubernetes.io/basic-auth"
    stringData = {
      username = "utopia"
      password = data.google_secret_manager_secret_version.utopia_db_password[0].secret_data
    }
  })

  depends_on = [kubernetes_namespace.utopia]
}

resource "kubectl_manifest" "utopia_db_cluster" {
  count = var.enable_utopia ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "postgresql.cnpg.io/v1"
    kind       = "Cluster"
    metadata = {
      name      = "utopia-db"
      namespace = local.utopia_namespace
    }
    spec = {
      instances = 1
      imageName = "ghcr.io/cloudnative-pg/postgresql:16-bookworm"

      bootstrap = {
        initdb = {
          database = "utopia"
          # Utopia migrates as the owner (UTOPIA_MIGRATION_URL), so `utopia` owns
          # the database; CREATE EXTENSION is the one superuser step and runs here.
          owner  = "utopia"
          secret = { name = "utopia-db-credentials" }
          postInitSQL = [
            "CREATE EXTENSION IF NOT EXISTS vector",
          ]
        }
      }

      storage = { size = "10Gi" }

      resources = {
        requests = { cpu = "250m", memory = "512Mi" }
        limits   = { cpu = "1", memory = "2Gi" }
      }

      postgresql = {
        shared_preload_libraries = ["vector"]
      }
    }
  })

  wait_for_rollout = false

  depends_on = [
    kubernetes_namespace.utopia,
    kubectl_manifest.utopia_db_credentials,
  ]
}

# ---- The data directory: files, the search index and secret.key live here, so it
# is one ReadWriteOnce disk and the Deployment below recreates rather than rolls.

resource "kubernetes_persistent_volume_claim_v1" "utopia_data" {
  count = var.enable_utopia ? 1 : 0

  metadata {
    name      = "utopia-data"
    namespace = local.utopia_namespace
  }

  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = "standard-rwo"

    resources {
      requests = { storage = var.utopia_data_size }
    }
  }

  # The claim binds when the first pod schedules (WaitForFirstConsumer).
  wait_until_bound = false

  depends_on = [kubernetes_namespace.utopia]
}

# ---- The app.

resource "kubernetes_deployment_v1" "utopia" {
  count = var.enable_utopia ? 1 : 0

  metadata {
    name      = "utopia"
    namespace = local.utopia_namespace
    labels    = { app = "utopia" }
  }

  spec {
    replicas = 1

    # One disk, one writer: the old pod must release the volume before the new one starts.
    strategy { type = "Recreate" }

    selector {
      match_labels = { app = "utopia" }
    }

    template {
      metadata {
        labels = { app = "utopia" }
      }

      spec {
        # The image declares no USER, so it would run as root. The binary lives in
        # /usr/local/bin and the only directory it writes is the data volume, which
        # fsGroup makes writable for this uid.
        security_context {
          run_as_non_root = true
          run_as_user     = 1000
          run_as_group    = 1000
          fs_group        = 1000
        }

        container {
          name              = "utopia"
          image             = "${var.utopia_image_repository}:${var.utopia_image_tag}"
          image_pull_policy = "IfNotPresent"

          port {
            name           = "http"
            container_port = 1516
          }

          env {
            name = "UTOPIA_DB_PASSWORD"
            value_from {
              secret_key_ref {
                name = "utopia-db-credentials"
                key  = "password"
              }
            }
          }
          # Both URLs are the owner: the restricted utopia_app role the compose file
          # offers is created by a Postgres init script CNPG does not run.
          env {
            name  = "UTOPIA_DATABASE_URL"
            value = "postgres://utopia:$(UTOPIA_DB_PASSWORD)@utopia-db-rw.${local.utopia_namespace}.svc.cluster.local:5432/utopia"
          }
          env {
            name  = "UTOPIA_MIGRATION_URL"
            value = "postgres://utopia:$(UTOPIA_DB_PASSWORD)@utopia-db-rw.${local.utopia_namespace}.svc.cluster.local:5432/utopia"
          }
          # Seeded from Secret Manager rather than generated into the volume on first
          # start: a lost disk then loses files, not every stored model credential.
          env {
            name = "UTOPIA_SECRET_KEY"
            value_from {
              secret_key_ref {
                name = "utopia-app"
                key  = "secret-key"
              }
            }
          }
          env {
            name  = "UTOPIA_BIND_ADDR"
            value = "0.0.0.0:1516"
          }
          env {
            name  = "UTOPIA_WEB_DIST"
            value = "/app/web-dist"
          }
          env {
            name  = "UTOPIA_DATA_DIR"
            value = "/app/data"
          }
          env {
            name  = "UTOPIA_DB_MAX_CONNECTIONS"
            value = "16"
          }
          # Safe only because oauth2-proxy stands in front: every visitor who reaches
          # this form already holds a re-cinq Google account.
          env {
            name  = "UTOPIA_OPEN_REGISTRATION"
            value = "true"
          }
          # nginx terminates TLS and forwards X-Forwarded-Proto, which is what Utopia
          # reads to mark its session cookie Secure; this pins it regardless.
          env {
            name  = "UTOPIA_COOKIE_SECURE"
            value = "true"
          }

          volume_mount {
            name       = "data"
            mount_path = "/app/data"
          }

          readiness_probe {
            http_get {
              path = "/api/v1/health"
              port = "http"
            }
            initial_delay_seconds = 5
            period_seconds        = 10
          }

          liveness_probe {
            http_get {
              path = "/api/v1/health"
              port = "http"
            }
            # Migrations run at start; give them room before the first kill.
            initial_delay_seconds = 60
            period_seconds        = 30
          }

          # Autopilot bills requests; the Rust server plus a Tantivy index wants more
          # than the dashboards, and the limit is headroom for an ingest burst.
          resources {
            requests = { cpu = "250m", memory = "512Mi" }
            limits   = { cpu = "1", memory = "2Gi" }
          }
        }

        volume {
          name = "data"
          persistent_volume_claim {
            claim_name = "utopia-data"
          }
        }
      }
    }
  }

  depends_on = [
    kubectl_manifest.utopia_db_cluster,
    kubectl_manifest.es_utopia_app,
    kubernetes_persistent_volume_claim_v1.utopia_data,
  ]
}

resource "kubernetes_service_v1" "utopia" {
  count = var.enable_utopia ? 1 : 0

  metadata {
    name      = "utopia"
    namespace = local.utopia_namespace
    labels    = { app = "utopia" }
  }

  spec {
    selector = { app = "utopia" }

    port {
      name        = "http"
      port        = 80
      target_port = "http"
    }
  }
}

# ---- The gate: oauth2-proxy in auth_request mode, as in monitoring.tf.

resource "helm_release" "utopia_oauth2_proxy" {
  count = var.enable_utopia ? 1 : 0

  name       = "utopia-oauth2-proxy"
  repository = "https://oauth2-proxy.github.io/manifests"
  chart      = "oauth2-proxy"
  namespace  = local.utopia_namespace
  version    = "10.7.0"

  values = [yamlencode({
    config = {
      existingSecret = "utopia-oauth"
      emailDomains   = ["re-cinq.com"]
    }

    extraArgs = {
      provider      = "google"
      redirect-url  = "${local.utopia_url}/oauth2/callback"
      cookie-domain = var.utopia_hostname
      cookie-secure = true
      reverse-proxy = true
    }

    resources = {
      requests = { cpu = "50m", memory = "64Mi" }
      limits   = { cpu = "200m", memory = "128Mi" }
    }
  })]

  depends_on = [
    kubernetes_namespace.utopia,
    kubectl_manifest.es_utopia_oauth,
  ]
}

# Two Ingresses, as everywhere else here: the auth annotations apply per Ingress,
# and the sign-in endpoint must not itself require a sign-in. No tls block on this
# one; nginx picks the certificate by SNI from the Ingress below.
resource "kubernetes_ingress_v1" "utopia_oauth2_proxy" {
  count = var.enable_utopia ? 1 : 0

  metadata {
    name      = "utopia-oauth2-proxy"
    namespace = local.utopia_namespace
  }

  spec {
    ingress_class_name = "nginx-ingress"

    rule {
      host = var.utopia_hostname

      http {
        path {
          path      = "/oauth2"
          path_type = "Prefix"

          backend {
            service {
              name = "utopia-oauth2-proxy"
              port {
                number = 80
              }
            }
          }
        }
      }
    }
  }

  depends_on = [helm_release.utopia_oauth2_proxy]
}

resource "kubernetes_ingress_v1" "utopia" {
  count = var.enable_utopia ? 1 : 0

  metadata {
    name      = "utopia"
    namespace = local.utopia_namespace

    annotations = {
      "cert-manager.io/cluster-issuer"            = "letsencrypt-prod"
      "external-dns.alpha.kubernetes.io/hostname" = var.utopia_hostname

      "nginx.ingress.kubernetes.io/auth-url"    = "${local.utopia_url}/oauth2/auth"
      "nginx.ingress.kubernetes.io/auth-signin" = "${local.utopia_url}/oauth2/start?rd=$escaped_request_uri"

      # Document uploads, and the alerts stream is server-sent events held open.
      "nginx.ingress.kubernetes.io/proxy-body-size"    = "200m"
      "nginx.ingress.kubernetes.io/proxy-read-timeout" = "3600"
    }
  }

  spec {
    ingress_class_name = "nginx-ingress"

    tls {
      hosts       = [var.utopia_hostname]
      secret_name = "utopia-tls"
    }

    rule {
      host = var.utopia_hostname

      http {
        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              name = "utopia"
              port {
                number = 80
              }
            }
          }
        }
      }
    }
  }

  depends_on = [kubernetes_service_v1.utopia]
}

# Registration is open behind the gate, so the Service must not be reachable
# around the gate: only the ingress controller may talk to the app pod.
resource "kubectl_manifest" "utopia_ingress_only" {
  count = var.enable_utopia ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "networking.k8s.io/v1"
    kind       = "NetworkPolicy"
    metadata = {
      name      = "utopia-ingress-only"
      namespace = local.utopia_namespace
    }
    spec = {
      podSelector = {
        matchLabels = { app = "utopia" }
      }
      policyTypes = ["Ingress"]
      ingress = [
        {
          from = [
            {
              namespaceSelector = {
                matchLabels = { "kubernetes.io/metadata.name" = var.ingress_controller_namespace }
              }
            },
          ]
        },
      ]
    }
  })

  depends_on = [kubernetes_namespace.utopia]
}
