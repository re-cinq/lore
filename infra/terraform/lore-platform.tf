# --------------------------------------------------------------------------
# Lore platform — ONE Helm release for all five application workloads.
#
# Replaces the former per-service releases (lore-floor, lore-mcp, lore-ui,
# lore-db extras). The umbrella chart vendors them as subcharts and
# stamps each resource with its own namespace, so this single release spans
# lore-api / lore-ui / lore-db and the others. The release record
# lives in the `lore-floor` home namespace, which is all that is left of the
# Floor Lore ran itself (deleted 2026-10-02).
#
# Deploy ownership: Terraform owns config (the `values` below); CI owns image
# tags. `reuse_values = true` means a `terraform apply` MERGES this config on
# top of the live release's values WITHOUT resetting image tags — so it never
# downgrades the SHA-pinned images CI deploys (`helm upgrade --set
# <svc>.image.tag=<sha> --reset-then-reuse-values`).
#
# Values are nested under each subchart's chart name:
#   lore-api / lore-ui / lore-db-helm / ...
# Cluster, namespaces, ESO ExternalSecrets, the 2 ingresses, the CNPG cluster
# CR, and Dgraph remain Terraform-owned (see the other *.tf files).
# --------------------------------------------------------------------------

locals {
  # In-cluster base URL of the lore-mcp gateway (Service `lore-mcp-gateway` in the
  # lore-api namespace, ClusterIP :8080). Agent run pods MUST use this rather than the
  # public host in var.lore_mcp_url: Dataplane V2 short-circuits a VIP whose backend
  # lives in this cluster, and the post-DNAT 10.x address is dropped by the run-pod
  # egress policy's RFC1918 except-list.
  lore_mcp_in_cluster = "http://lore-mcp-gateway.lore-api.svc.cluster.local:8080"

  # In-cluster base URL of the stations service (ADR-024 service stations). Only
  # the Floor calls it — nothing reaches it from outside, so there is no ingress.
  stations_in_cluster = "http://lore-stations.lore-stations.svc.cluster.local:8080"

  # The Lore API as its in-cluster peers reach it. The web-ui already hardcoded
  # this string; naming it once stops the two drifting.
  lore_api_in_cluster = "http://lore-api.lore-api.svc.cluster.local:3000"
}

resource "helm_release" "lore_platform" {
  name             = "lore-platform"
  chart            = "${path.module}/modules/gke-mcp/lore-platform"
  namespace        = "lore-floor"
  create_namespace = false

  # Preserve CI-deployed image tags across terraform applies (see header).
  reuse_values = true

  values = [yamlencode({
    # ---- Lore API (lore-api namespace) ----
    "lore-api" = {
      replicaCount = 1
      gcpProject   = var.project_id
      env = {
        PORT             = "3000"
        CONTEXT_PATH     = "/context"
        LORE_TEAM        = "platform"
        GCP_PROJECT      = var.project_id
        LORE_DB_HOST     = "lore-db-rw.lore-db.svc.cluster.local"
        LORE_DB_PORT     = "5432"
        LORE_DB_NAME     = "lore"
        LORE_DB_USER     = "lore"
        LORE_DGRAPH_HTTP = local.dgraph_http_url
        # Rendered onto UI-authored agent recipes (#1080): the live Lore MCP gateway
        # and the run-telemetry sink, so a repo that overrides its recipe through
        # /agents keeps the mid-run memory/context access and the cost accounting a
        # seeded recipe has. IN-CLUSTER:
        # — Dataplane V2 short-circuits the public VIP and the post-DNAT 10.x address
        # hits the run-pod egress policy's except-list, so the public host hangs.
        # Empty leaves the fields off entirely rather than pointing a pod at nothing.
        LORE_MCP_URL = var.lore_mcp_url != "" ? "${local.lore_mcp_in_cluster}/mcp" : ""
        # The canonical repo-hook URL lore-api installs and classifies against:
        # the public webhook hostname, which the ingress rewrites onto this
        # service's POST /api/webhook/github. lore_webhook_hostname still
        # serves the legacy hook alias.
        LORE_WEBHOOK_URL = var.lore_event_router_hostname != "" ? "https://${var.lore_event_router_hostname}/api/events" : ""
        LORE_API_URL     = var.lore_api_url
        # The web UI's base address: a spec statement cites the plan block it
        # came from under the plan's page there, and a review's start comment
        # links the plan. The stations already read it.
        LORE_UI_URL = var.lore_ui_url
        # /spend's compute ESTIMATE prices pod-hours at these rates. The code
        # defaults to an e2 on-demand ballpark ($0.022/cpu-h), but this platform
        # runs on GKE AUTOPILOT, which bills the pod's own requests at roughly
        # twice that — so the unset default understated every pod figure on the
        # page by ~2x. Autopilot general-purpose, europe-west1. The real invoice
        # arrives separately through the billing export (ADR-043); this only has
        # to be honest about "now".
        LORE_GKE_CPU_HOUR_USD     = "0.0489"
        LORE_GKE_MEM_GIB_HOUR_USD = "0.0054"
      }
      dbPasswordSecret  = { name = "lore-api-db-password", key = "password" }
      ingestTokenSecret = { name = "lore-ingest-token", key = "token" }
      githubAppSecret = {
        name              = "github-app-credentials"
        appIdKey          = "app-id"
        privateKeyKey     = "private-key"
        installationIdKey = "installation-id"
      }
      webhookSecret       = { name = "lore-webhook-secret", key = "secret" }
      internalTokenSecret = { name = "lore-agent-internal-token", key = "token" }
      # The cost-sync maintenance job's org admin key (#1348). The es_mcp_anthropic
      # ExternalSecret only carries the anthropic-admin-key entry when
      # var.enable_anthropic_admin_key is true; the env stays optional either way.
      anthropicAdminKeySecret = { name = "lore-anthropic-key", key = "anthropic-admin-key" }
      # The external floor engine (namespace `floor`); see var.enable_external_floor.
      floor = {
        enabled   = var.enable_external_floor
        skillsUrl = "${local.lore_mcp_in_cluster}/skills"
      }
    }

    # ---- Web UI (lore-ui namespace) ----
    "lore-ui" = {
      replicaCount = 1
      env = {
        LORE_DB_HOST       = "lore-db-rw.lore-db.svc.cluster.local"
        LORE_DB_PORT       = "5432"
        LORE_DB_NAME       = "lore"
        LORE_DB_USER       = "lore"
        GITHUB_ALLOWED_ORG = var.github_org
        GITHUB_APP_SLUG    = var.github_app_slug
        NEXTAUTH_URL       = var.lore_ui_url
        LORE_LOG_BUCKET    = "lore-task-logs-${var.project_id}"
        LORE_API_URL       = local.lore_api_in_cluster
        # The tab's live socket (runs + plan editor) is opened by the BROWSER,
        # so it needs lore-api's public address, not the in-cluster one above
        # (ADR-047, ADR-048).
        LORE_WS_URL = "wss://${local.lore_api_hostname}/api/ws"
        # The cluster dashboard's public address, which is also the ONLY way the
        # UI learns that a dashboard exists — enable_headlamp is a Terraform
        # variable and the browser cannot see it. No address, no sidebar link.
        #
        # Set unconditionally, empty when disabled, because this release is
        # applied with reuse_values = true: a key dropped from this map is
        # carried forward from the previous release rather than removed, so
        # omitting it when the feature is turned off would leave the UI pointing
        # at a dashboard that is no longer deployed.
        HEADLAMP_URL = var.enable_headlamp ? "https://${var.headlamp_hostname}" : ""
      }
      dbPasswordSecret  = { name = "lore-db-password", key = "password" }
      ingestTokenSecret = { name = "lore-ingest-token", key = "token" }
      githubAppSecret   = { name = "github-app-credentials" }
      oauthSecret       = { name = "lore-ui-oauth" }
    }

    # ---- lore-db ownership-reconciler add-on (lore-db namespace) ----
    "lore-db-helm" = {
      cluster = { name = "lore-db" }
      # Terraform (privileged) always runs the ownership-reconciler hook; CI deploys
      # disable it (their SA can't manage lore-db RBAC). reuse_values would otherwise
      # carry CI's `false` forward, so set it true explicitly here.
      ownershipReconciler = { enabled = true }
    }

    # ---- Stations (lore-stations namespace) ----
    # Standalone units of work, one endpoint each. It holds a pool ON PURPOSE —
    # that is the point of the service form: a station beside the data asks the
    # data instead of paying for an HTTP seam per method.
    "lore-stations" = {
      # Workload Identity for the gcp-cost-sync station's BigQuery read; the
      # KSA annotation is what makes the metadata server answer as the GSA.
      serviceAccount = {
        annotations = var.enable_gcp_billing_export ? {
          "iam.gke.io/gcp-service-account" = google_service_account.lore_stations[0].email
        } : {}
      }
      env = merge({
        LORE_DB_HOST = "lore-db-rw.lore-db.svc.cluster.local"
        LORE_DB_PORT = "5432"
        LORE_DB_NAME = "lore"
        LORE_DB_USER = "lore"
        PORT         = "8080"
        # A station reads and writes through the Lore API where it holds no pool.
        # The IN-CLUSTER address, like every other in-cluster caller: the
        # external URL would leave the cluster and come back through the
        # ingress for a call between two pods in it.
        LORE_API_URL = local.lore_api_in_cluster
        # The web UI's external address: the issues station links a plan's
        # story issue to its plan page. Unset, the story names the plan instead.
        LORE_UI_URL = var.lore_ui_url
        }, var.enable_gcp_billing_export ? {
        # Where the gcp-cost-sync station finds the Cloud Billing export.
        # Unset (flag off) → the sync reports a skip and /spend keeps showing
        # the estimate only.
        LORE_GCP_BILLING_PROJECT = var.project_id
        LORE_GCP_BILLING_DATASET = google_bigquery_dataset.billing_export[0].dataset_id
      } : {})
      # The anthropic-cost-sync station's org admin key (moved here from lore-api
      # in #1522). Its OWN namespace secret — secrets are namespace-scoped, so
      # the lore-api `lore-anthropic-key` is out of reach here. es_stations_anthropic_key
      # carries the anthropic-admin-key entry only when
      # var.enable_anthropic_admin_key is true; the env stays optional either way.
      anthropicAdminKeySecret = { name = "lore-stations-anthropic-key", key = "anthropic-admin-key" }
      floor                   = { enabled = var.enable_external_floor }
    }
  })]

  depends_on = [
    kubernetes_namespace.lore_agent,
    kubernetes_namespace.lore_api,
    kubernetes_namespace.lore_ui,
    kubernetes_namespace.lore_db,
    kubernetes_namespace.lore_stations,
    kubernetes_service_account.lore_ui,
    kubectl_manifest.lore_db_cluster,
  ]
}
