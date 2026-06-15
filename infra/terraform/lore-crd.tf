# --------------------------------------------------------------------------
# LoreTask CRD, RBAC, and controller deployment
# --------------------------------------------------------------------------

# --- CRD ---

resource "kubectl_manifest" "loretask_crd" {
  yaml_body = file("${path.module}/modules/gke-mcp/loretask-crd/crd.yaml")
}

# --- Controller RBAC (multi-document: ServiceAccount, ClusterRole, ClusterRoleBinding) ---

data "kubectl_file_documents" "controller_rbac" {
  content = templatefile("${path.module}/modules/gke-mcp/loretask-crd/rbac.yaml", {
    project_id = var.project_id
  })
}

resource "kubectl_manifest" "controller_rbac" {
  for_each  = data.kubectl_file_documents.controller_rbac.manifests
  yaml_body = each.value

  depends_on = [
    kubectl_manifest.loretask_crd,
    kubernetes_namespace.lore_agent,
  ]
}

# --- Controller Deployment ---

resource "kubectl_manifest" "loretask_controller" {
  yaml_body = templatefile("${path.module}/modules/gke-mcp/loretask-crd/controller-deployment.yaml", {
    project_id   = var.project_id
    lore_api_url = var.lore_api_url
  })

  wait_for_rollout = false

  depends_on = [
    kubectl_manifest.controller_rbac,
    kubernetes_namespace.lore_agent,
  ]
}

# --- NetworkPolicy restricting Job pod egress ---

resource "kubectl_manifest" "loretask_networkpolicy" {
  yaml_body = file("${path.module}/modules/gke-mcp/loretask-crd/networkpolicy.yaml")

  depends_on = [
    kubernetes_namespace.lore_agent,
  ]
}

# --- Agent RBAC (ClusterRole + ClusterRoleBinding for lore-agent SA) ---

data "kubectl_file_documents" "agent_rbac" {
  content = file("${path.module}/modules/gke-mcp/loretask-crd/agent-rbac.yaml")
}

resource "kubectl_manifest" "agent_rbac" {
  for_each  = data.kubectl_file_documents.agent_rbac.manifests
  yaml_body = each.value

  depends_on = [
    kubectl_manifest.loretask_crd,
    kubernetes_namespace.lore_agent,
  ]
}
