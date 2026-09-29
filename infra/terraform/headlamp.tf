# ---------------------------------------------------------------------------
# Headlamp — the cluster dashboard, behind a Google sign-in gate.
#
# WHY NOT RANCHER. This cluster is GKE Autopilot. Rancher creates resources in
# kube-system to install, which Autopilot forbids, and an Autopilot cluster cannot
# even be REGISTERED into a Rancher running elsewhere: the cattle-cluster-agent
# always places its leader Lease in kube-system, GKE's Warden admission controller
# denies it, and the agent never becomes leader (rancher/rancher#57604). Rancher
# 2.12 also certifies only k8s 1.31-1.33; this cluster runs 1.35. There is no
# configuration that fixes any of that, so the dashboard is Headlamp — the CNCF /
# Kubernetes SIG-UI project that replaced the archived Kubernetes Dashboard.
#
# WHY A PROXY RATHER THAN HEADLAMP'S OWN OIDC. Headlamp's OIDC mode hands the
# provider's id_token to the Kubernetes API server as a bearer token, which only
# works if the API server trusts that issuer. GKE does not expose the
# --oidc-issuer-url flag, so a Google login can never become a Kubernetes
# identity here. Authentication therefore happens one layer out, in oauth2-proxy,
# and Headlamp talks to the API server as its own ServiceAccount.
#
# THE CONSEQUENCE, STATED PLAINLY: every person who passes the Google gate acts as
# ONE Kubernetes identity. Google decides who gets in; the ClusterRole below
# decides what anyone can do; the Kubernetes audit log records the ServiceAccount,
# not the human. That is only acceptable because the role is read-only and cannot
# read Secrets. Do not widen it without replacing this design.
# ---------------------------------------------------------------------------

resource "kubernetes_namespace" "headlamp" {
  count = var.enable_headlamp ? 1 : 0

  metadata { name = "headlamp" }
}

# The security boundary. Rules are written out rather than aggregated: an
# aggregationRule would mean labelling ClusterRoles, and the only label that picks
# up the built-in read-only set is aggregate-to-view, which would widen `view`
# itself for every subject in the cluster.
resource "kubectl_manifest" "headlamp_view" {
  count = var.enable_headlamp ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "rbac.authorization.k8s.io/v1"
    kind       = "ClusterRole"
    metadata = {
      name = "headlamp-view"
    }
    rules = [
      # The core group is the one place `resources: ["*"]` would be wrong, because
      # that is where Secrets live. Hence the explicit list: adding "secrets" here
      # hands every re-cinq Google account the Anthropic key, the GitHub App
      # private key and the database password, through a browser.
      {
        apiGroups = [""]
        resources = [
          "componentstatuses",
          "configmaps",
          "endpoints",
          "events",
          "limitranges",
          "namespaces",
          "nodes",
          "persistentvolumeclaims",
          "persistentvolumes",
          "pods",
          "pods/log",
          "pods/status",
          "replicationcontrollers",
          "resourcequotas",
          "serviceaccounts",
          "services",
        ]
        verbs = ["get", "list", "watch"]
      },
      # Named groups carry no equivalent of a Secret's payload — a Certificate, an
      # ExternalSecret or a CNPG Cluster references secrets by NAME, never by value
      # — so `*` is safe here and keeps the dashboard useful.
      #
      # This list is enumerated, not wildcarded, precisely so the core group above
      # stays excluded. A new operator's CRDs stay invisible to Headlamp until its
      # group is added here; that is the cost of not granting Secret access.
      {
        apiGroups = [
          # Kubernetes' own
          "admissionregistration.k8s.io",
          "apiextensions.k8s.io",
          "apiregistration.k8s.io",
          "apps",
          "autoscaling",
          "batch",
          "certificates.k8s.io",
          "coordination.k8s.io",
          "discovery.k8s.io",
          "events.k8s.io",
          "flowcontrol.apiserver.k8s.io",
          "metrics.k8s.io",
          "networking.k8s.io",
          "node.k8s.io",
          "policy",
          "rbac.authorization.k8s.io",
          "scheduling.k8s.io",
          "storage.k8s.io",
          # Lore's own resources. The group is `agents.re-cinq.com` — Agent,
          # AgentDefinition and Station. Seeing an agent run is the main reason
          # this dashboard exists, and the built-in `view` role would hide all
          # three, because those CRDs carry no aggregate-to-view label.
          "agents.re-cinq.com",
          # The operators that break in ways worth looking at
          "acme.cert-manager.io",
          "cert-manager.io",
          "external-secrets.io",
          "generators.external-secrets.io",
          "postgresql.cnpg.io",
          "barmancloud.cnpg.io",
          "monitoring.googleapis.com",
          "telemetry.googleapis.com",
          "snapshot.storage.k8s.io",
          # Networking and autoscaling, incl. Autopilot's own machinery. Cilium is
          # how this cluster implements NetworkPolicy, so it is where a blocked
          # agent-pod egress becomes visible.
          "cilium.io",
          "gateway.networking.k8s.io",
          "inference.networking.k8s.io",
          "autoscaling.k8s.io",
          "autoscaling.x-k8s.io",
          "auto.gke.io",
          "autoscaling.gke.io",
          "internal.autoscaling.gke.io",
          "cloud.google.com",
          "datalayer.gke.io",
          "ha.gke.io",
          "hub.gke.io",
          "networking.gke.io",
          "node.gke.io",
          "nodemanagement.gke.io",
          "security.cloud.google.com",
          "warden.gke.io",
        ]
        resources = ["*"]
        verbs     = ["get", "list", "watch"]
      },
    ]
  })

  depends_on = [kubernetes_namespace.headlamp]
}

resource "kubectl_manifest" "headlamp_view_binding" {
  count = var.enable_headlamp ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "rbac.authorization.k8s.io/v1"
    kind       = "ClusterRoleBinding"
    metadata = {
      name = "headlamp-view"
    }
    roleRef = {
      apiGroup = "rbac.authorization.k8s.io"
      kind     = "ClusterRole"
      name     = "headlamp-view"
    }
    subjects = [
      {
        kind      = "ServiceAccount"
        name      = "headlamp"
        namespace = "headlamp"
      },
    ]
  })

  depends_on = [kubectl_manifest.headlamp_view]
}

resource "helm_release" "headlamp" {
  count = var.enable_headlamp ? 1 : 0

  name       = "headlamp"
  repository = "https://kubernetes-sigs.github.io/headlamp/"
  chart      = "headlamp"
  namespace  = "headlamp"
  version    = "0.45.0"

  values = [yamlencode({
    config = {
      # Authenticate every Headlamp user as the pod's own ServiceAccount. This is
      # what removes the token prompt, and it is safe ONLY because oauth2-proxy
      # stands in front and headlamp-view is read-only. See the file header.
      unsafeUseServiceAccountToken = true

      # Headlamp does not do the OIDC here, so skip the empty Secret the chart
      # would otherwise create for it.
      oidc = {
        secret = {
          create = false
        }
      }
    }

    serviceAccount = {
      create = true
      name   = "headlamp"
    }

    # The chart's default is clusterRoleName: cluster-admin. On a public hostname
    # shared with another tenant that is the worst available outcome, so the
    # chart's binding is off and headlamp-view above is bound instead.
    clusterRoleBinding = {
      create = false
    }

    # The ingress is a kubernetes_ingress_v1 below, matching every other public
    # door in this module (lore-ui.tf) and keeping the auth annotations in one place.
    ingress = {
      enabled = false
    }

    # The chart ships `resources: {}`. On Autopilot an unset request is not free:
    # it is billed at the 500m / 2Gi default. 100m / 256Mi matches lore-ui and
    # sits inside Autopilot's 1:1-to-1:6.5 memory:CPU band for the
    # general-purpose class.
    #
    # The limit is deliberately 4x the request. A 256Mi LIMIT is the documented
    # way to have Headlamp OOMKilled while merely browsing a cluster this size,
    # and because Autopilot bills requests rather than limits, the headroom costs
    # nothing. No PodDisruptionBudget: at one replica a PDB blocks Autopilot node
    # drains, and an occasional restart of a stateless dashboard is the cheaper
    # failure.
    resources = {
      requests = {
        cpu    = "100m"
        memory = "256Mi"
      }
      limits = {
        cpu    = "500m"
        memory = "1Gi"
      }
    }
  })]

  depends_on = [
    kubernetes_namespace.headlamp,
    kubectl_manifest.headlamp_view_binding,
  ]
}

# The gate. Runs in auth_request mode: nginx asks it about every request, so its
# own upstream is /dev/null and it proxies nothing.
resource "helm_release" "oauth2_proxy" {
  count = var.enable_headlamp ? 1 : 0

  name       = "oauth2-proxy"
  repository = "https://oauth2-proxy.github.io/manifests"
  chart      = "oauth2-proxy"
  namespace  = "headlamp"
  version    = "10.7.0"

  values = [yamlencode({
    config = {
      # Credentials come from GCP Secret Manager via ESO; nothing secret is in
      # Terraform. The chart reads exactly the keys client-id / client-secret /
      # cookie-secret out of this secret.
      existingSecret = "headlamp-oauth"

      # THIS is the re-cinq restriction: oauth2-proxy checks the verified email
      # address Google returns and rejects everything else. Widening it to ["*"]
      # would publish read access to the whole cluster on the open internet.
      emailDomains = ["re-cinq.com"]
    }

    extraArgs = {
      provider = "google"

      # Must match the Authorized redirect URI on the Google OAuth client exactly.
      redirect-url = "https://${var.headlamp_hostname}/oauth2/callback"

      cookie-domain = var.headlamp_hostname
      cookie-secure = true

      # Required behind nginx. Without it oauth2-proxy ignores X-Forwarded-*, and
      # builds its redirect from the in-cluster address instead of the public host.
      reverse-proxy = true
    }

    resources = {
      requests = {
        cpu    = "50m"
        memory = "64Mi"
      }
      limits = {
        cpu    = "200m"
        memory = "128Mi"
      }
    }
  })]

  depends_on = [
    kubernetes_namespace.headlamp,
    kubectl_manifest.es_headlamp_oauth,
  ]
}

# Two Ingresses, not one. nginx applies its external-auth annotations per Ingress,
# so a single Ingress carrying them would also guard /oauth2/* — and a sign-in
# endpoint that requires you to be signed in is a redirect loop.
#
# This one deliberately has NO tls block: nginx picks the certificate by SNI from
# any Ingress serving the host, so declaring TLS twice for one hostname would only
# give cert-manager two Certificates racing for the same secret.
resource "kubernetes_ingress_v1" "headlamp_oauth2_proxy" {
  count = var.enable_headlamp && var.headlamp_hostname != "" ? 1 : 0

  metadata {
    name      = "headlamp-oauth2-proxy"
    namespace = "headlamp"
  }

  spec {
    ingress_class_name = "nginx-ingress"

    rule {
      host = var.headlamp_hostname

      http {
        path {
          path      = "/oauth2"
          path_type = "Prefix"

          backend {
            service {
              name = "oauth2-proxy"
              port {
                number = 80
              }
            }
          }
        }
      }
    }
  }

  depends_on = [helm_release.oauth2_proxy]
}

resource "kubernetes_ingress_v1" "headlamp" {
  count = var.enable_headlamp && var.headlamp_hostname != "" ? 1 : 0

  metadata {
    name      = "headlamp"
    namespace = "headlamp"

    annotations = {
      "cert-manager.io/cluster-issuer"            = "letsencrypt-prod"
      "external-dns.alpha.kubernetes.io/hostname" = var.headlamp_hostname

      # Every request is sub-requested to oauth2-proxy first; an unauthenticated
      # one is sent to Google and comes back to where it was going.
      "nginx.ingress.kubernetes.io/auth-url"    = "https://${var.headlamp_hostname}/oauth2/auth"
      "nginx.ingress.kubernetes.io/auth-signin" = "https://${var.headlamp_hostname}/oauth2/start?rd=$escaped_request_uri"

      # Headlamp holds watch connections open for as long as a tab is, so the
      # default 60s read timeout would make the UI silently stop updating.
      "nginx.ingress.kubernetes.io/proxy-read-timeout" = "3600"
    }
  }

  spec {
    ingress_class_name = "nginx-ingress"

    tls {
      hosts       = [var.headlamp_hostname]
      secret_name = "headlamp-tls"
    }

    rule {
      host = var.headlamp_hostname

      http {
        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              name = "headlamp"
              port {
                number = 80
              }
            }
          }
        }
      }
    }
  }

  depends_on = [helm_release.headlamp]
}
