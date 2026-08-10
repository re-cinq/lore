# --------------------------------------------------------------------------
# Lore platform — ONE Helm release for all five application workloads.
#
# Replaces the former per-service releases (lore-floor, lore-mcp, lore-ui,
# lore-db extras, ai-agents). The umbrella chart vendors them as subcharts and
# stamps each resource with its own namespace, so this single release spans
# lore-floor / lore-api / lore-ui / lore-db / ai-agents. The release record
# lives in the `lore-floor` home namespace.
#
# Deploy ownership: Terraform owns config (the `values` below); CI owns image
# tags. `reuse_values = true` means a `terraform apply` MERGES this config on
# top of the live release's values WITHOUT resetting image tags — so it never
# downgrades the SHA-pinned images CI deploys (`helm upgrade --set
# <svc>.image.tag=<sha> --reset-then-reuse-values`).
#
# Values are nested under each subchart's chart name:
#   lore-floor / lore-api / lore-ui / lore-db-helm / ai-agents
# Cluster, namespaces, ESO ExternalSecrets, the 2 ingresses, the CNPG cluster
# CR, and Dgraph remain Terraform-owned (see the other *.tf files).
# --------------------------------------------------------------------------

resource "helm_release" "lore_platform" {
  name             = "lore-platform"
  chart            = "${path.module}/modules/gke-mcp/lore-platform"
  namespace        = "lore-floor"
  create_namespace = false

  # Preserve CI-deployed image tags across terraform applies (see header).
  reuse_values = true

  values = [yamlencode({
    # ---- Floor (lore-floor namespace) ----
    "lore-floor" = {
      taskTypesConfig = file("${path.module}/../../scripts/task-types.yaml")
      gcpProject      = var.project_id
      env = {
        LORE_DB_HOST     = "lore-db-rw.lore-db.svc.cluster.local"
        LORE_DB_PORT     = "5432"
        LORE_DB_NAME     = "lore"
        LORE_DB_USER     = "lore"
        LORE_DGRAPH_HTTP = local.dgraph_http_url
        ANTHROPIC_MODEL  = "claude-haiku-4-5-20251001"
        TASK_TYPES_PATH  = "/config/task-types.yaml"
        PORT             = "8080"
        LORE_INGEST_URL  = var.lore_api_url
        LORE_LOG_BUCKET  = "lore-task-logs-${var.project_id}"
        # Raw agent-NDJSON run archive (agent-events.ts). Reuses the task-logs
        # bucket — the archive keys are namespaced under __agent_events__/ and the
        # bucket's log_retention_days lifecycle prunes them. Without this the
        # archive is a silent no-op (agentEventsArchive returns null).
        LORE_AGENT_EVENTS_BUCKET = "lore-task-logs-${var.project_id}"
        # Web-UI base: the "Lore review has started — <id>" comment (loreTaskRef)
        # links the run id to /assembly-lines/<id>, which the resolver renders.
        LORE_UI_URL = var.lore_ui_url
      }
      dbPasswordSecret        = { name = "lore-db-password", key = "password" }
      anthropicKeySecret      = { name = "lore-anthropic-key", key = "anthropic-api-key" }
      anthropicAdminKeySecret = { name = "lore-anthropic-key", key = "anthropic-admin-key" }
      githubAppSecret = {
        name              = "github-app-credentials"
        appIdKey          = "app-id"
        privateKeyKey     = "private-key"
        installationIdKey = "installation-id"
      }
      ingestTokenSecret   = { name = "lore-ingest-token", key = "token" }
      internalTokenSecret = { name = "lore-agent-internal-token", key = "token" }
      webhookSecret       = { name = "lore-floor-webhook-secret", key = "secret" }
    }

    # ---- Lore API (lore-api namespace) ----
    "lore-api" = {
      taskTypesConfig = file("${path.module}/../../scripts/task-types.yaml")
      replicaCount    = 1
      env = {
        PORT             = "3000"
        CONTEXT_PATH     = "/context"
        TASK_TYPES_PATH  = "/config/task-types.yaml"
        LORE_TEAM        = "platform"
        GCP_PROJECT      = var.project_id
        LORE_DB_HOST     = "lore-db-rw.lore-db.svc.cluster.local"
        LORE_DB_PORT     = "5432"
        LORE_DB_NAME     = "lore"
        LORE_DB_USER     = "lore"
        LORE_DGRAPH_HTTP = local.dgraph_http_url
        LORE_AGENT_URL   = "http://lore-floor.lore-floor.svc.cluster.local:8080"
        LORE_WEBHOOK_URL = var.lore_webhook_hostname != "" ? "https://${var.lore_webhook_hostname}/api/webhook/github" : ""
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
        NEXTAUTH_URL       = var.lore_ui_url
        LORE_LOG_BUCKET    = "lore-task-logs-${var.project_id}"
        LORE_API_URL       = "http://lore-api.lore-api.svc.cluster.local:3000"
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

    # ai-agents: 1 controller replica (leader-election still elects the sole pod);
    # other config (seedCatalog, image digests, cross-ns refs) stays subchart default.
    # loreMcpUrl templates into the seeded agent recipes' mcp_servers URL (the live
    # Lore MCP the pods reach); the gateway serves MCP at /mcp. Empty leaves the
    # sentinel unreplaced-but-harmless (no mcp_servers URL to connect to).
    "ai-agents" = {
      controller = { replicas = 1 }
      loreMcpUrl = var.lore_mcp_url != "" ? "${var.lore_mcp_url}/mcp" : ""
      # The same gateway serves the /skills registry the agent init fetches skills +
      # settings from (resources.skills_source). Empty leaves the sentinel unreplaced —
      # harmless, the init skips the fetch.
      #
      # MUST STAY APPLIED. This value being absent from the cluster is what caused the
      # 2026-08-10 outage: every Claude-agent node failed at boot with
      #
      #   [agent] Error: Settings file not found: /agent/.claude/settings.json
      #   [agent] {"kind":"lifecycle","exitCode":1,"phase":"agent","status":"failed"}
      #
      # #1090 added this line and #1093 deployed the v0.8.1 images, but the two halves
      # ship by different paths: the chart goes out via CI, this file only on a manual
      # `terraform apply`. No apply ran, so the images went live with the config absent.
      # Contrary to what #1093 and ai-agents-helm/values.yaml both assert, the seam is
      # NOT inert without a source — ADR-030 is the accurate one ("The Claude adapter
      # emits --settings; skills need no flag"): v0.8.1 passes
      # --settings /agent/.claude/settings.json unconditionally, while the init only
      # WRITES that file when skills_source is set. No source, no file, exit 1.
      #
      # Blast radius when unset: all 13 Claude-agent recipes (review, implementation,
      # gap-fill, feature-planning, ...). Stations carry no skills, so ingest/detect
      # lines stay green and the board looks healthy while every LLM node is dead.
      #
      # So: clearing this does not disable the feature, it breaks it. If the seam ever
      # needs to be genuinely off, the images must go back too (and note contracts
      # 0.8.1 is now a hard dependency of per-task-token.ts / agent-crd.ts).
      #
      # Verify after apply that the recipes carry a source — read
      # .spec.resources.skills_source off the `general` AgentDefinition in ai-agents;
      # it should be <gateway>/skills, not empty.
      loreSkillsUrl = var.lore_mcp_url != "" ? "${var.lore_mcp_url}/skills" : ""
    }
  })]

  depends_on = [
    kubernetes_namespace.lore_agent,
    kubernetes_namespace.lore_api,
    kubernetes_namespace.lore_ui,
    kubernetes_namespace.lore_db,
    kubernetes_namespace.ai_agents,
    kubernetes_service_account.lore_ui,
    kubectl_manifest.lore_db_cluster,
    kubectl_manifest.es_ai_agents_secrets,
    kubectl_manifest.es_ai_agents_ghcr,
  ]
}
