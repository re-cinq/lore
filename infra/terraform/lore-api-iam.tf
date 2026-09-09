# ---------------------------------------------------------------------------
# Lore API — Workload Identity for Vertex AI embeddings
# ---------------------------------------------------------------------------
#
# lore-api embeds every query, chunk, memory and fact through Vertex AI
# `text-embedding-005`. Embedding moved here from the Floor in ADR-032, but the
# identity did not move with it: the lore-api pod ran as the namespace's unbound
# `default` KSA, every Vertex call answered 403 (from 2026-08-13 to 2026-09-09),
# and retrieval silently degraded to keyword-only ranking while the store
# filled with unembedded rows.
#
# A dedicated GSA rather than a second binding on `lore-agent`: that account
# also holds `storage.objectAdmin` and `logging.viewer`, which the API does
# not need. The KSA lives in the lore-api subchart
# (lore-api-helm/templates/serviceaccount.yaml) and is annotated with this
# GSA's email. Apply this BEFORE merging the chart change — CI helm-deploys but
# never runs terraform, and a KSA annotated to a GSA that does not exist fails
# to mint a token exactly the way the unbound default did.

resource "google_service_account" "lore_api" {
  account_id   = "lore-api"
  display_name = "Lore API — Vertex embeddings"
}

resource "google_project_iam_member" "lore_api_aiplatform" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.lore_api.email}"
}

resource "google_service_account_iam_member" "lore_api_workload_identity" {
  service_account_id = google_service_account.lore_api.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[${kubernetes_namespace.lore_api.metadata[0].name}/lore-api]"
}
