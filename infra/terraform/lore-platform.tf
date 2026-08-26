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

locals {
  # In-cluster base URL of the lore-mcp gateway (Service `lore-mcp-gateway` in the
  # lore-api namespace, ClusterIP :8080). Agent run pods MUST use this rather than the
  # public host in var.lore_mcp_url: Dataplane V2 short-circuits a VIP whose backend
  # lives in this cluster, and the post-DNAT 10.x address is dropped by the run-pod
  # egress policy's RFC1918 except-list. Host/port must stay in step with the
  # ai-agents-helm `mcpSink` values that open the matching NetworkPolicy hole.
  lore_mcp_in_cluster = "http://lore-mcp-gateway.lore-api.svc.cluster.local:8080"

  # In-cluster base URL of the event-router (ADR-044). Producers are ordinary
  # Deployments, not run pods, so the ClusterIP is reachable and no public hop
  # is involved — only GitHub reaches the router from outside, via its ingress.
  event_router_in_cluster = "http://lore-event-router.lore-event-router.svc.cluster.local:8080"

  # In-cluster base URL of the stations service (ADR-024 service stations). Only
  # the Floor calls it — nothing reaches it from outside, so there is no ingress.
  stations_in_cluster = "http://lore-stations.lore-stations.svc.cluster.local:8080"

  # The Lore API as its in-cluster peers reach it. The web-ui already hardcoded
  # this string; naming it once stops the two drifting.
  lore_api_in_cluster = "http://lore-api.lore-api.svc.cluster.local:3000"

  # In-cluster base URL of the cluster agent (ADR-024). Only the Floor and
  # lore-api call it, and its NetworkPolicy allows ingress from those two
  # namespaces only — nothing reaches it from outside, so there is no ingress.
  cluster_agent_in_cluster = "http://lore-cluster-agent.lore-cluster-agent.svc.cluster.local:8080"
}

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
        # Web-UI base: the "Lore review has started — <id>" comment (loreTaskRef)
        # links the run id to /assembly-lines/<id>, which the resolver renders.
        LORE_UI_URL = var.lore_ui_url
        # Where this Floor REPORTS events (ADR-044). Unset would silently fall
        # back to writing pipeline.events directly, which is right on a laptop
        # and wrong here — the fallback logs which way it resolved.
        EVENT_ROUTER_URL = local.event_router_in_cluster
        # Where the Floor RUNS a station (ADR-024). It keeps the schedule and the
        # job_runs row; the work is over there.
        STATIONS_URL = local.stations_in_cluster
        # The Floor performs no Kubernetes operation itself any more; it asks
        # the cluster agent (ADR-024).
        CLUSTER_AGENT_URL = local.cluster_agent_in_cluster
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
        # The /agents editor's catalog saves land through the cluster agent —
        # lore-api holds no Kubernetes client (ADR-024).
        CLUSTER_AGENT_URL = local.cluster_agent_in_cluster
        # Rendered onto UI-authored agent recipes (#1080): the live Lore MCP gateway
        # and the run-telemetry sink, so a repo that overrides its recipe through
        # /agents keeps the mid-run memory/context access and the cost accounting a
        # seeded recipe has. IN-CLUSTER for the same reason as ai-agents' loreMcpUrl
        # — Dataplane V2 short-circuits the public VIP and the post-DNAT 10.x address
        # hits the run-pod egress policy's except-list, so the public host hangs.
        # Empty leaves the fields off entirely rather than pointing a pod at nothing.
        LORE_MCP_URL = var.lore_mcp_url != "" ? "${local.lore_mcp_in_cluster}/mcp" : ""
        # LORE_AGENT_EVENTS_URL was read by the code and set NOWHERE, so the http sink
        # never materialised on a UI-authored recipe.
        LORE_AGENT_EVENTS_URL = "http://lore-floor.lore-floor.svc.cluster.local:8080/api/agent-events"
        LORE_WEBHOOK_URL      = var.lore_webhook_hostname != "" ? "https://${var.lore_webhook_hostname}/api/webhook/github" : ""
        # The connect-a-cluster hand-out (#1572): lore-api serves its own
        # public URL + the event-router front door to satellite installers.
        LORE_API_URL                 = var.lore_api_url
        LORE_EVENT_ROUTER_PUBLIC_URL = var.lore_event_router_hostname != "" ? "https://${var.lore_event_router_hostname}" : ""
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
      # var.anthropic_admin_api_key is set; the env stays optional either way.
      anthropicAdminKeySecret = { name = "lore-anthropic-key", key = "anthropic-admin-key" }
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
        LORE_API_URL       = local.lore_api_in_cluster
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
      #
      # The URL is IN-CLUSTER, not var.lore_mcp_url's public host: Dataplane V2
      # short-circuits a VIP whose backend lives in this cluster and the post-DNAT 10.x
      # address hits the run-pod egress policy's RFC1918 except-list, so the public
      # gateway host merely hangs from an agent pod. var.lore_mcp_url stays the on/off
      # switch (set = the gateway is deployed). See ai-agents-helm/values.yaml.
      loreMcpUrl = var.lore_mcp_url != "" ? "${local.lore_mcp_in_cluster}/mcp" : ""
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
      #
      # 2026-08-10 follow-up: applying this was necessary but not sufficient. The value
      # was ALSO being pruned by a stale CRD schema (helm never upgrades crds/), and once
      # it finally reached a pod the fetch could not connect at all — the URL has to be
      # in-cluster, same as loreMcpUrl above. All three had to be fixed (#1126).
      loreSkillsUrl = var.lore_mcp_url != "" ? "${local.lore_mcp_in_cluster}/skills" : ""
    }

    # ---- Cluster agent (lore-cluster-agent namespace) ----
    # The only process that talks to this cluster's Kubernetes API. Holds no
    # database; holds the GitHub App triple, because it mints the per-task token
    # itself so no token crosses the network.
    "lore-cluster-agent" = {
      agentsNamespace = "ai-agents"
      env = {
        PORT = "8080"
        # This process also PUSHES: it owns the Agent-CR watch (a WATCH is the one
        # cluster capability that cannot be a request — Kubernetes streams down a
        # connection opened outward) and reports terminal phases to the router.
        # Unset, the watch does not start and says so; the symptom would otherwise
        # be silence — no terminal event on the bus, every node waiting for the
        # reaper.
        EVENT_ROUTER_URL = local.event_router_in_cluster
      }
    }

    # ---- Stations (lore-stations namespace) ----
    # Standalone units of work, one endpoint each. It holds a pool ON PURPOSE —
    # that is the point of the service form: a station beside the data asks the
    # data instead of paying for an HTTP seam per method.
    "lore-stations" = {
      env = {
        LORE_DB_HOST = "lore-db-rw.lore-db.svc.cluster.local"
        LORE_DB_PORT = "5432"
        LORE_DB_NAME = "lore"
        LORE_DB_USER = "lore"
        PORT         = "8080"
        # This service DRAINS as well as serving: the walk publishes a node whose
        # station runs here, and without a router to claim it from, the visit
        # sits open until the reaper times it out. `merge_step` has no pod recipe
        # to fall back to, so this is a prerequisite rather than a tuning knob.
        # Unset falls back to the local pool, which is right on a laptop and
        # wrong here — the fallback logs which way it resolved.
        EVENT_ROUTER_URL = local.event_router_in_cluster
        # A station reads and writes through the Lore API where it holds no pool.
        # The IN-CLUSTER address, like every other in-cluster caller: the
        # external URL would leave the cluster and come back through the
        # ingress for a call between two pods in it.
        LORE_API_URL = local.lore_api_in_cluster
      }
    }

    # ---- Event router (lore-event-router namespace) ----
    # The one writer of pipeline.events (ADR-044): the GitHub webhook ingress and
    # the Agent CR watch. Its DB credentials are its own; its ingest token is the
    # SAME secret every producer presents, so the two ends cannot drift apart.
    "lore-event-router" = {
      env = {
        LORE_DB_HOST          = "lore-db-rw.lore-db.svc.cluster.local"
        LORE_DB_PORT          = "5432"
        LORE_DB_NAME          = "lore"
        LORE_DB_USER          = "lore"
        PORT                  = "8080"
        LORE_STATION_BACKEND  = "k8s"
        LORE_AGENTS_NAMESPACE = "ai-agents"
      }
    }
  })]

  depends_on = [
    kubernetes_namespace.lore_agent,
    kubernetes_namespace.lore_api,
    kubernetes_namespace.lore_ui,
    kubernetes_namespace.lore_db,
    kubernetes_namespace.ai_agents,
    kubernetes_namespace.lore_event_router,
    kubernetes_namespace.lore_stations,
    kubernetes_namespace.lore_cluster_agent,
    kubernetes_service_account.lore_ui,
    kubectl_manifest.lore_db_cluster,
    kubectl_manifest.es_ai_agents_secrets,
    kubectl_manifest.es_ai_agents_ghcr,
  ]
}
