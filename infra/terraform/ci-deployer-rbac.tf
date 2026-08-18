# CI deployer RBAC authorization (two layers).
#
# The GitHub Actions deploy SA (github-actions-deploy@…, managed in the bootstrap
# infra — only referenced here by email) runs `helm upgrade --install lore-platform`.
# The umbrella reconciles the `agent-launcher` Role in ai-agents (caller-rbac.yaml),
# which requires the deployer to clear BOTH authz layers — a gap that red-lined main's
# CD until this was granted (2026-07):
#
#   1. Cloud IAM — GKE checks `container.roles.update` / `container.roleBindings.*`
#      before the K8s RBAC API call is even allowed. Granted via a least-privilege
#      custom role (no cluster-admin).
#   2. Kubernetes RBAC — the privilege-escalation guard blocks an identity from
#      creating/patching a Role that grants permissions it does not itself hold
#      (here: pods/log, agents/*). The `escalate`/`bind` verbs on roles/rolebindings
#      let the deployer reconcile RBAC without holding every downstream permission.
#
# NOTE: these were first applied by hand (gcloud/kubectl) to unblock CD. On first
# `terraform apply`, import the existing objects so Terraform adopts (not recreates)
# them, or delete the hand-made ones first:
#   terraform import google_project_iam_custom_role.deployer_rbac \
#     projects/<project>/roles/loreDeployerRbac
#   terraform import kubernetes_cluster_role.deployer_rbac lore-ci-deployer-rbac
#   terraform import kubernetes_cluster_role_binding.deployer_rbac lore-ci-deployer-rbac

locals {
  # Managed in the bootstrap infra; referenced by email so this repo can own the
  # RBAC grants where the need lives.
  ci_deployer_sa = "github-actions-deploy@${var.project_id}.iam.gserviceaccount.com"
}

# ── Layer 1: Cloud IAM ───────────────────────────────────────────────────────
resource "google_project_iam_custom_role" "deployer_rbac" {
  role_id     = "loreDeployerRbac"
  title       = "Lore Deployer RBAC"
  description = "Lets the CI deployer reconcile Roles/RoleBindings via helm (ai-agents agent-launcher Role) and the cluster-scoped CRD-upgrade hook RBAC (ai-agents-crd-upgrade)."
  permissions = [
    "container.roles.get",
    "container.roles.update",
    "container.roleBindings.get",
    "container.roleBindings.create",
    "container.roleBindings.update",
    # The ai-agents CRD-upgrade hook (re-cinq/lore#1134) ships a ClusterRole +
    # ClusterRoleBinding as pre-upgrade hook resources. Helm's default
    # `before-hook-creation` delete policy DELETES and re-creates them on every
    # upgrade, so the deployer needs the full cluster-scope verb set — creation
    # alone got the first hook run through and then every later deploy died on
    # the delete (2026-08-18).
    "container.clusterRoles.get",
    "container.clusterRoles.create",
    "container.clusterRoles.update",
    "container.clusterRoles.delete",
    "container.clusterRoleBindings.get",
    "container.clusterRoleBindings.create",
    "container.clusterRoleBindings.update",
    "container.clusterRoleBindings.delete",
  ]
}

resource "google_project_iam_member" "deployer_rbac" {
  project = var.project_id
  role    = google_project_iam_custom_role.deployer_rbac.id
  member  = "serviceAccount:${local.ci_deployer_sa}"
}

# ── Layer 2: Kubernetes RBAC (escalation guard) ──────────────────────────────
# NOT in the umbrella chart on purpose: the deployer cannot grant itself
# permissions via the chart it deploys (chicken-and-egg), so this is applied by
# the higher-privilege Terraform identity instead.
resource "kubernetes_cluster_role" "deployer_rbac" {
  metadata {
    name = "lore-ci-deployer-rbac"
  }

  rule {
    api_groups = ["rbac.authorization.k8s.io"]
    resources  = ["roles"]
    verbs      = ["get", "list", "create", "update", "patch", "delete", "escalate", "bind"]
  }

  rule {
    api_groups = ["rbac.authorization.k8s.io"]
    resources  = ["rolebindings"]
    verbs      = ["get", "list", "create", "update", "patch", "delete", "bind"]
  }

  # The ai-agents CRD-upgrade hook's cluster-scoped RBAC (re-cinq/lore#1134):
  # helm delete-and-recreates the hook's ClusterRole/ClusterRoleBinding on every
  # upgrade (`before-hook-creation` is the default hook delete policy), and the
  # escalation guard requires `escalate` to create a ClusterRole granting CRD
  # patch rights the deployer does not hold itself. Creation alone got the first
  # hook run through; every later deploy then died on the delete (2026-08-18).
  # Unscoped like the namespaced rules above: `escalate` at create time cannot be
  # reliably limited by resourceNames.
  rule {
    api_groups = ["rbac.authorization.k8s.io"]
    resources  = ["clusterroles", "clusterrolebindings"]
    verbs      = ["get", "list", "create", "update", "patch", "delete", "escalate", "bind"]
  }
}

resource "kubernetes_cluster_role_binding" "deployer_rbac" {
  metadata {
    name = "lore-ci-deployer-rbac"
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role.deployer_rbac.metadata[0].name
  }

  subject {
    api_group = "rbac.authorization.k8s.io"
    kind      = "User"
    name      = local.ci_deployer_sa
  }
}
