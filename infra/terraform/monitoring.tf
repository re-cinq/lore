# Grafana's Google identity on the legacy project. The stack itself runs on the
# internal cluster from re-cinq/infrastructure; this account goes with the project.

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
  member             = "serviceAccount:${var.project_id}.svc.id.goog[monitoring/grafana]"
}
