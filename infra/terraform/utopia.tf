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
  # A digest pins the bytes; a tag only names them and can be re-pushed.
  utopia_image = var.utopia_image_digest != "" ? "${var.utopia_image_repository}@${var.utopia_image_digest}" : "${var.utopia_image_repository}:${var.utopia_image_tag}"

  # What the app pod may talk to beyond the cluster: the public internet, which is
  # everything except the private ranges, the link-local range the cloud metadata
  # server sits in, and this cluster's pod and Service ranges. The in-app SSRF
  # guard covers RSS and web sources only; the admin-set model endpoint and
  # Ask-the-Data connection strings are fetched as given, so this is the fence.
  utopia_private_cidrs = [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "169.254.0.0/16",
    var.cluster_services_cidr,
  ]
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
          # In the application database: postInitSQL runs in `postgres`, and the
          # first install put the extension there, where migration 1 could not
          # see it and the owner was refused creating its own (2026-10-09).
          owner  = "utopia"
          secret = { name = "utopia-db-credentials" }
          # The runtime role is created here, before the first migration, because
          # upstream's migration 0010 grants it the business tables only when it
          # already exists and never looks again. Its password is the operator's to
          # set (managed.roles below), so no secret value sits in this manifest.
          postInitApplicationSQL = [
            "CREATE EXTENSION IF NOT EXISTS vector",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'utopia_app') THEN CREATE ROLE utopia_app LOGIN; END IF; END $$",
            "GRANT CONNECT ON DATABASE utopia TO utopia_app",
          ]
        }
      }

      # The role the app runs as (upstream SECURITY.md): reads and writes the
      # business tables, appends to the ledger, owns nothing. Migrations and the
      # vector-index builds stay on the owner through UTOPIA_MIGRATION_URL. On a
      # cluster that predates this block the operator creates the role; the grants
      # are then one `psql` by hand (docs/managing-secrets.md), since the migration
      # that would have made them has already run.
      managed = {
        roles = [
          {
            name           = "utopia_app"
            ensure         = "present"
            login          = true
            inherit        = true
            passwordSecret = { name = "utopia-app-db-credentials" }
          },
        ]
      }

      storage = { size = "10Gi" }

      # Utopia's job worker runs up to 64 jobs at once against this database: a
      # backfill of one repo (thousands of pushed items) held it at its old 1-CPU
      # limit and every page waited behind the queue. A full core requested, two
      # to burst into.
      resources = {
        requests = { cpu = "1", memory = "1Gi" }
        limits   = { cpu = "2", memory = "2Gi" }
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
    kubectl_manifest.es_utopia_app_db,
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
        # Upstream's image is public; one of ours on ghcr.io/re-cinq is not.
        image_pull_secrets {
          name = "ghcr-pull-secret"
        }

        security_context {
          run_as_non_root = true
          run_as_user     = 1000
          run_as_group    = 1000
          fs_group        = 1000

          seccomp_profile {
            type = "RuntimeDefault"
          }
        }

        container {
          name              = "utopia"
          image             = local.utopia_image
          image_pull_policy = "IfNotPresent"

          # The same posture as Lore's job pods: nothing to escalate to, no
          # capabilities, and a root filesystem it cannot write. The binary writes
          # the data volume and, for PDF and OCR work, the temp directory below.
          security_context {
            allow_privilege_escalation = false
            read_only_root_filesystem  = true

            capabilities {
              drop = ["ALL"]
            }
          }

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
          env {
            name = "UTOPIA_APP_DB_PASSWORD"
            value_from {
              secret_key_ref {
                name = "utopia-app-db-credentials"
                key  = "password"
              }
            }
          }
          # Runtime as the restricted role, migrations as the owner (managed.roles above).
          env {
            name  = "UTOPIA_DATABASE_URL"
            value = "postgres://utopia_app:$(UTOPIA_APP_DB_PASSWORD)@utopia-db-rw.${local.utopia_namespace}.svc.cluster.local:5432/utopia"
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
          # Closed: a re-cinq.com Google sign-in opens the account (UTOPIA_OIDC_ALLOWED_DOMAINS
          # below), and lore-api reaches the pod around the gate (utopia_ingress_only), where
          # an open form would be a door for anyone holding that pod.
          env {
            name  = "UTOPIA_OPEN_REGISTRATION"
            value = "false"
          }
          # nginx terminates TLS and forwards X-Forwarded-Proto, which is what Utopia
          # reads to mark its session cookie Secure; this pins it regardless.
          env {
            name  = "UTOPIA_COOKIE_SECURE"
            value = "true"
          }
          # Sign-in with Google, through the gate's own OAuth client: its redirect URIs
          # carry Utopia's callback beside oauth2-proxy's.
          env {
            name  = "UTOPIA_OIDC_ISSUER"
            value = "https://accounts.google.com"
          }
          # Google sign-in is the only way in: a re-cinq.com login links the account with
          # its email, or opens one. Password sign-in comes back with "true" if Google breaks.
          env {
            name  = "UTOPIA_OIDC_ALLOWED_DOMAINS"
            value = "re-cinq.com"
          }
          env {
            name  = "UTOPIA_PASSWORD_LOGIN"
            value = "false"
          }
          env {
            name  = "UTOPIA_OIDC_REDIRECT_URI"
            value = "${local.utopia_url}/api/v1/auth/oidc/callback"
          }
          env {
            name = "UTOPIA_OIDC_CLIENT_ID"
            value_from {
              secret_key_ref {
                name = "utopia-oauth"
                key  = "client-id"
              }
            }
          }
          env {
            name = "UTOPIA_OIDC_CLIENT_SECRET"
            value_from {
              secret_key_ref {
                name = "utopia-oauth"
                key  = "client-secret"
              }
            }
          }

          volume_mount {
            name       = "data"
            mount_path = "/app/data"
          }

          volume_mount {
            name       = "tmp"
            mount_path = "/tmp"
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

        volume {
          name = "tmp"
          empty_dir {}
        }
      }
    }
  }

  depends_on = [
    kubectl_manifest.utopia_db_cluster,
    kubectl_manifest.es_utopia_app,
    kubectl_manifest.es_utopia_app_db,
    kubectl_manifest.es_utopia_ghcr,
    kubectl_manifest.es_utopia_oauth,
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

# Only the ingress controller (the Google gate in front of every browser) and
# lore-api may talk to the app pod. lore-api mirrors each repository's spec and
# ADR graph into Utopia (ADR-052) and comes in around the gate, so it holds a
# Utopia credential of its own on every call: a source key for pushes, a
# person's session for setup. Registration is closed, so this second door
# cannot mint an account.
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
        {
          from = [
            {
              namespaceSelector = {
                matchLabels = { "kubernetes.io/metadata.name" = "lore-api" }
              }
              podSelector = {
                matchLabels = { app = "lore-api" }
              }
            },
          ]
          ports = [
            { protocol = "TCP", port = 1516 },
          ]
        },
      ]
    }
  })

  depends_on = [kubernetes_namespace.utopia]
}

# The app pod's way out: DNS, its own database, and the public internet on 80 and
# 443. Every in-cluster address is off the list (local.utopia_private_cidrs), so a
# model endpoint or data-source connection string typed into Utopia's admin page
# cannot reach lore-db, lore-api or the floor.
#
# DNS here is NodeLocal DNSCache: a pod's resolver is 169.254.20.10, answered by the
# node-local-dns pod on its own node (host network), which forwards to kube-dns. A
# rule that opens kube-dns alone leaves every lookup timing out (2026-10-14, the
# first apply: "pool timed out while waiting for an open connection", the database
# never seeing a packet). Both DNS tiers are opened, by pod label and by address.
resource "kubectl_manifest" "utopia_egress" {
  count = var.enable_utopia ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "networking.k8s.io/v1"
    kind       = "NetworkPolicy"
    metadata = {
      name      = "utopia-egress"
      namespace = local.utopia_namespace
    }
    spec = {
      podSelector = {
        matchLabels = { app = "utopia" }
      }
      policyTypes = ["Egress"]
      egress = [
        {
          to = [
            {
              namespaceSelector = {
                matchLabels = { "kubernetes.io/metadata.name" = "kube-system" }
              }
              podSelector = { matchLabels = { "k8s-app" = "kube-dns" } }
            },
            {
              namespaceSelector = {
                matchLabels = { "kubernetes.io/metadata.name" = "kube-system" }
              }
              podSelector = { matchLabels = { "k8s-app" = "node-local-dns" } }
            },
            { ipBlock = { cidr = "169.254.20.10/32" } },
          ]
          ports = [
            { protocol = "UDP", port = 53 },
            { protocol = "TCP", port = 53 },
          ]
        },
        {
          to = [
            { podSelector = { matchLabels = { "cnpg.io/cluster" = "utopia-db" } } },
          ]
          ports = [{ protocol = "TCP", port = 5432 }]
        },
        {
          to = [
            { ipBlock = { cidr = "0.0.0.0/0", except = local.utopia_private_cidrs } },
          ]
          ports = [
            { protocol = "TCP", port = 443 },
            { protocol = "TCP", port = 80 },
          ]
        },
      ]
    }
  })

  depends_on = [kubernetes_namespace.utopia]
}

# The database answers the app and the CNPG operator (in var.cnpg_operator_namespace,
# which drives the instance through its manager port), nobody else in the cluster.
resource "kubectl_manifest" "utopia_db_ingress_only" {
  count = var.enable_utopia ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "networking.k8s.io/v1"
    kind       = "NetworkPolicy"
    metadata = {
      name      = "utopia-db-ingress-only"
      namespace = local.utopia_namespace
    }
    spec = {
      podSelector = {
        matchLabels = { "cnpg.io/cluster" = "utopia-db" }
      }
      policyTypes = ["Ingress"]
      ingress = [
        {
          from  = [{ podSelector = { matchLabels = { app = "utopia" } } }]
          ports = [{ protocol = "TCP", port = 5432 }]
        },
        {
          from = [
            {
              namespaceSelector = {
                matchLabels = { "kubernetes.io/metadata.name" = var.cnpg_operator_namespace }
              }
              podSelector = { matchLabels = { "app.kubernetes.io/name" = "cloudnative-pg" } }
            },
          ]
        },
      ]
    }
  })

  depends_on = [kubernetes_namespace.utopia]
}
