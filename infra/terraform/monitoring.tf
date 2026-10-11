# ---------------------------------------------------------------------------
# Monitoring — Prometheus scraping every service, Grafana behind the Google gate.
#
# WHAT IS SCRAPED. Every Lore service serves OpenTelemetry metrics as Prometheus text
# on its `metrics` port (ADR-050); the floor's api and the agent subsystem's controller
# serve their own `/metrics`. One kube-prometheus-stack release installs the operator,
# a Prometheus, kube-state-metrics and Grafana; the monitors below name the targets.
#
# WHY SELF-HOSTED AND NOT MANAGED. Google Managed Prometheus bills per sample, so it
# grows with every histogram and label a dashboard asks for. This stack bills its pods'
# requests, about $27 a month, flat. GKE's own pod metrics stay free in Cloud
# Monitoring either way, so Grafana reads those through a Cloud Monitoring datasource
# under the Grafana GSA below.
#
# WHAT IS OFF, AND WHY. The cluster is GKE Autopilot: node-exporter needs hostPath and
# hostNetwork, which Autopilot forbids, and the control plane is hidden, so its
# scrape targets and their alert rules are disabled rather than permanently red. The
# operator's kubelet Service goes into this namespace: Autopilot's Warden denies the
# default write into kube-system, the same mechanism that kept Rancher out (headlamp.tf).
#
# THE GATE. The same shape as Headlamp's: oauth2-proxy with the same Google client,
# two Ingresses, re-cinq.com only. Grafana trusts the email header the proxy sets and
# nginx forwards; nginx overwrites a client-sent copy, so the ingress path cannot be
# forged, and the NetworkPolicy at the end keeps in-cluster callers from forging it
# at the Service.
# ---------------------------------------------------------------------------

locals {
  monitoring_namespace = "monitoring"
  grafana_url          = "https://${var.grafana_hostname}"
  grafana_service      = "kube-prometheus-stack-grafana"
}

resource "kubernetes_namespace" "monitoring" {
  count = var.enable_monitoring ? 1 : 0

  metadata { name = local.monitoring_namespace }
}

# ---- Grafana's Google identity: read-only on Cloud Monitoring, for GKE's free pod metrics.

resource "google_service_account" "grafana" {
  count = var.enable_monitoring ? 1 : 0

  account_id   = "lore-grafana"
  display_name = "Lore Grafana — Cloud Monitoring reads"
}

resource "google_project_iam_member" "grafana_monitoring_viewer" {
  count = var.enable_monitoring ? 1 : 0

  project = var.project_id
  role    = "roles/monitoring.viewer"
  member  = "serviceAccount:${google_service_account.grafana[0].email}"
}

resource "google_service_account_iam_member" "grafana_workload_identity" {
  count = var.enable_monitoring ? 1 : 0

  service_account_id = google_service_account.grafana[0].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[${local.monitoring_namespace}/grafana]"
}

# ---- The stack.

resource "helm_release" "kube_prometheus_stack" {
  count = var.enable_monitoring ? 1 : 0

  name       = "kube-prometheus-stack"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  namespace  = local.monitoring_namespace
  version    = "92.2.0"

  # The CRDs, the webhook's certificate job and the Prometheus disk all land on a
  # first install; the provider's default 300 s is tight for that.
  timeout = 600
  wait    = true

  values = [yamlencode({
    # Helm never upgrades CRDs on its own; the chart's job does, on a chart bump.
    crds = { upgradeJob = { enabled = true } }

    # Not on Autopilot (hostPath, hostNetwork) and not visible on GKE (the control plane).
    nodeExporter          = { enabled = false }
    alertmanager          = { enabled = false }
    kubeControllerManager = { enabled = false }
    kubeScheduler         = { enabled = false }
    kubeEtcd              = { enabled = false }
    kubeProxy             = { enabled = false }
    coreDns               = { enabled = false }
    defaultRules = {
      rules = {
        alertmanager           = false
        etcd                   = false
        kubeControllerManager  = false
        kubeSchedulerAlerting  = false
        kubeSchedulerRecording = false
        kubeProxy              = false
        nodeExporterAlerting   = false
        nodeExporterRecording  = false
        windows                = false
      }
    }

    prometheusOperator = {
      # The kubelet Service the operator creates may not go into kube-system here.
      kubeletService = { namespace = local.monitoring_namespace }
      resources = {
        requests = { cpu = "50m", memory = "128Mi" }
        limits   = { memory = "256Mi" }
      }
      prometheusConfigReloader = {
        resources = {
          requests = { cpu = "50m", memory = "64Mi" }
          limits   = { memory = "128Mi" }
        }
      }
      admissionWebhooks = {
        patch = { resources = { requests = { cpu = "50m", memory = "64Mi" } } }
      }
    }
    kubelet = { namespace = local.monitoring_namespace }

    prometheus = {
      prometheusSpec = {
        # Pick up every monitor in the cluster, not only the ones carrying this
        # release's label: the targets below live in their own namespaces.
        serviceMonitorSelectorNilUsesHelmValues = false
        podMonitorSelectorNilUsesHelmValues     = false
        ruleSelectorNilUsesHelmValues           = false
        probeSelectorNilUsesHelmValues          = false
        scrapeConfigSelectorNilUsesHelmValues   = false
        serviceMonitorNamespaceSelector         = {}
        podMonitorNamespaceSelector             = {}

        retention     = "15d"
        retentionSize = "8GiB"
        storageSpec = {
          volumeClaimTemplate = {
            spec = {
              storageClassName = "standard-rwo"
              accessModes      = ["ReadWriteOnce"]
              resources        = { requests = { storage = "10Gi" } }
            }
          }
        }
        # Autopilot bills requests, and an unset request is billed at 500m / 2Gi.
        resources = {
          requests = { cpu = "250m", memory = "1Gi" }
          limits   = { memory = "2Gi" }
        }
      }
    }

    "kube-state-metrics" = {
      resources = {
        requests = { cpu = "50m", memory = "128Mi" }
        limits   = { memory = "256Mi" }
      }
    }

    grafana = {
      # A helm-test hook pod has no place under Terraform.
      testFramework = { enabled = false }

      serviceAccount = {
        create = true
        name   = "grafana"
        annotations = {
          "iam.gke.io/gcp-service-account" = google_service_account.grafana[0].email
        }
      }

      # The ingress is a kubernetes_ingress_v1 below, like every other public door here.
      ingress = { enabled = false }

      "grafana.ini" = {
        server = {
          root_url = local.grafana_url
          domain   = var.grafana_hostname
        }
        # The identity arrives as a header oauth2-proxy set and nginx forwarded (the
        # auth-response-headers annotation below); Grafana signs the person up on
        # first sight. Editor, not Admin: the Google gate restricts WHO, this
        # restricts what a first visit can change.
        "auth.proxy" = {
          enabled         = true
          header_name     = "X-Auth-Request-Email"
          header_property = "email"
          auto_sign_up    = true
          sync_ttl        = 60
        }
        auth             = { disable_login_form = true, disable_signout_menu = true }
        "auth.anonymous" = { enabled = false }
        users            = { auto_assign_org = true, auto_assign_org_role = "Editor" }
      }

      # The in-cluster Prometheus is provisioned by the chart; this adds GKE's own
      # pod metrics, read as the Grafana GSA through the metadata server.
      additionalDataSources = [
        {
          name     = "Cloud Monitoring"
          type     = "stackdriver"
          uid      = "cloud-monitoring"
          access   = "proxy"
          editable = false
          jsonData = {
            authenticationType = "gce"
            defaultProject     = var.project_id
          }
        },
      ]

      # The Lore dashboards are ConfigMaps below; the sidecar files them by annotation.
      sidecar = {
        dashboards = {
          folderAnnotation = "grafana_folder"
          provider         = { foldersFromFilesStructure = true }
        }
        resources = {
          requests = { cpu = "50m", memory = "64Mi" }
          limits   = { memory = "128Mi" }
        }
      }

      resources = {
        requests = { cpu = "100m", memory = "256Mi" }
        limits   = { memory = "1Gi" }
      }
    }
  })]

  depends_on = [
    kubernetes_namespace.monitoring,
    google_service_account_iam_member.grafana_workload_identity,
  ]
}

# ---- The gate: a second oauth2-proxy, because a cookie is scoped to its host and
# the /oauth2 Ingress must sit beside the Service it fronts.

resource "helm_release" "grafana_oauth2_proxy" {
  count = var.enable_monitoring ? 1 : 0

  name       = "grafana-oauth2-proxy"
  repository = "https://oauth2-proxy.github.io/manifests"
  chart      = "oauth2-proxy"
  namespace  = local.monitoring_namespace
  version    = "10.7.0"

  values = [yamlencode({
    config = {
      existingSecret = "grafana-oauth"
      emailDomains   = ["re-cinq.com"]
    }

    extraArgs = {
      provider      = "google"
      redirect-url  = "${local.grafana_url}/oauth2/callback"
      cookie-domain = var.grafana_hostname
      cookie-secure = true
      reverse-proxy = true
      # Answer the auth sub-request with X-Auth-Request-Email, the header Grafana reads.
      set-xauthrequest = true
    }

    resources = {
      requests = { cpu = "50m", memory = "64Mi" }
      limits   = { cpu = "200m", memory = "128Mi" }
    }
  })]

  depends_on = [
    kubernetes_namespace.monitoring,
    kubectl_manifest.es_grafana_oauth,
  ]
}

resource "kubernetes_ingress_v1" "grafana_oauth2_proxy" {
  count = var.enable_monitoring ? 1 : 0

  metadata {
    name      = "grafana-oauth2-proxy"
    namespace = local.monitoring_namespace
  }

  spec {
    ingress_class_name = "nginx-ingress"

    rule {
      host = var.grafana_hostname

      http {
        path {
          path      = "/oauth2"
          path_type = "Prefix"

          backend {
            service {
              name = "grafana-oauth2-proxy"
              port {
                number = 80
              }
            }
          }
        }
      }
    }
  }

  depends_on = [helm_release.grafana_oauth2_proxy]
}

resource "kubernetes_ingress_v1" "grafana" {
  count = var.enable_monitoring ? 1 : 0

  metadata {
    name      = "grafana"
    namespace = local.monitoring_namespace

    annotations = {
      "cert-manager.io/cluster-issuer"            = "letsencrypt-prod"
      "external-dns.alpha.kubernetes.io/hostname" = var.grafana_hostname

      "nginx.ingress.kubernetes.io/auth-url"    = "${local.grafana_url}/oauth2/auth"
      "nginx.ingress.kubernetes.io/auth-signin" = "${local.grafana_url}/oauth2/start?rd=$escaped_request_uri"
      # nginx sets this header from the auth sub-request's answer, replacing any
      # copy the client sent, which is what makes auth.proxy safe through here.
      "nginx.ingress.kubernetes.io/auth-response-headers" = "X-Auth-Request-Email"
    }
  }

  spec {
    ingress_class_name = "nginx-ingress"

    tls {
      hosts       = [var.grafana_hostname]
      secret_name = "grafana-tls"
    }

    rule {
      host = var.grafana_hostname

      http {
        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              name = local.grafana_service
              port {
                number = 80
              }
            }
          }
        }
      }
    }
  }

  depends_on = [helm_release.kube_prometheus_stack]
}

# Any pod in the cluster could otherwise curl Grafana's ClusterIP with a forged
# X-Auth-Request-Email and be signed up: only the ingress controller, and this
# namespace's own Prometheus scraping Grafana's /metrics, may reach it.
resource "kubectl_manifest" "grafana_ingress_only" {
  count = var.enable_monitoring ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "networking.k8s.io/v1"
    kind       = "NetworkPolicy"
    metadata = {
      name      = "grafana-ingress-only"
      namespace = local.monitoring_namespace
    }
    spec = {
      podSelector = {
        matchLabels = { "app.kubernetes.io/name" = "grafana" }
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
            {
              namespaceSelector = {
                matchLabels = { "kubernetes.io/metadata.name" = local.monitoring_namespace }
              }
            },
          ]
        },
      ]
    }
  })

  depends_on = [kubernetes_namespace.monitoring]
}

# ---- What Prometheus scrapes. A monitor lives in its target's namespace and selects
# by the labels the chart puts on the Service (or the pod, where there is no Service).

locals {
  lore_service_monitors = {
    lore-api         = { namespace = "lore-api", app = "lore-api" }
    lore-mcp-gateway = { namespace = "lore-api", app = "lore-mcp-gateway" }
    lore-stations    = { namespace = "lore-stations", app = "lore-stations" }
  }
}

resource "kubectl_manifest" "lore_service_monitors" {
  for_each = var.enable_monitoring ? local.lore_service_monitors : {}

  yaml_body = yamlencode({
    apiVersion = "monitoring.coreos.com/v1"
    kind       = "ServiceMonitor"
    metadata = {
      name      = each.key
      namespace = each.value.namespace
    }
    spec = {
      selector = { matchLabels = { app = each.value.app } }
      endpoints = [
        { port = "metrics", path = "/metrics", interval = "30s" },
      ]
    }
  })

  depends_on = [helm_release.kube_prometheus_stack]
}

# The floor's api serves /metrics on its http port (floor docs/api_sketch.md, "Metrics").
resource "kubectl_manifest" "floor_api_service_monitor" {
  count = var.enable_monitoring && var.enable_external_floor ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "monitoring.coreos.com/v1"
    kind       = "ServiceMonitor"
    metadata = {
      name      = "floor-api"
      namespace = "floor"
    }
    spec = {
      selector = {
        matchLabels = {
          "app.kubernetes.io/name"      = "floor"
          "app.kubernetes.io/component" = "api"
        }
      }
      endpoints = [
        { port = "http", path = "/metrics", interval = "30s" },
      ]
    }
  })

  depends_on = [helm_release.kube_prometheus_stack]
}

# The agent subsystem's controller has no Service: its /metrics is on the container
# port named `health`, so this one selects the pod. Agent job pods are deliberately
# not scraped — their policy admits no ingress at all.
resource "kubectl_manifest" "agent_controller_pod_monitor" {
  count = var.enable_monitoring && var.enable_external_floor ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "monitoring.coreos.com/v1"
    kind       = "PodMonitor"
    metadata = {
      name      = "agent-controller"
      namespace = "floor"
    }
    spec = {
      selector = {
        matchLabels = { "agents.re-cinq.com/component" = "controller" }
      }
      podMetricsEndpoints = [
        { port = "health", path = "/metrics", interval = "30s" },
      ]
    }
  })

  depends_on = [helm_release.kube_prometheus_stack]
}

# ---- The dashboards: one ConfigMap each, filed under "Lore" by the sidecar. No
# dashboard names an assembly line: the per-line board reads its lines from the
# metric labels, so a line added next month appears by itself (ADR-050).

locals {
  lore_dashboards = fileset("${path.module}/dashboards", "*.json")
}

resource "kubernetes_config_map" "lore_dashboards" {
  for_each = var.enable_monitoring ? local.lore_dashboards : toset([])

  metadata {
    name      = "lore-dashboard-${trimsuffix(each.value, ".json")}"
    namespace = local.monitoring_namespace
    labels = {
      grafana_dashboard = "1"
    }
    annotations = {
      grafana_folder = "Lore"
    }
  }

  data = {
    (each.value) = file("${path.module}/dashboards/${each.value}")
  }

  depends_on = [kubernetes_namespace.monitoring]
}
