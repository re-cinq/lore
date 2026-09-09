# Real GCP spend for the web-ui /spend page.
#
# Google publishes actual spend through exactly one machine-readable channel:
# the Cloud Billing export to BigQuery. Terraform owns everything around it —
# the dataset it lands in, the identity that reads it, the grants — but NOT the
# export itself: enabling "Standard usage cost" export into this dataset is a
# Cloud-Console-only step (Billing → Billing export) that needs Billing Account
# Administrator and has no API. Until a person flips it, the gcp-cost-sync
# station reports a skip and /spend keeps showing only the estimate.

variable "enable_gcp_billing_export" {
  description = "Provision the BigQuery dataset + read identity for the Cloud Billing export behind the /spend page's real GCP cost. The export itself must then be enabled once in the Cloud Console, targeting the billing_export dataset."
  type        = bool
  default     = false
}

variable "gcp_billing_dataset_location" {
  description = "Location of the billing-export dataset. Must match what the console-side export setup selects."
  type        = string
  default     = "EU"
}

resource "google_bigquery_dataset" "billing_export" {
  count = var.enable_gcp_billing_export ? 1 : 0

  dataset_id  = "billing_export"
  project     = var.project_id
  location    = var.gcp_billing_dataset_location
  description = "Cloud Billing standard usage-cost export (console-configured); read daily by the gcp-cost-sync station."

  # The export's history cannot be re-created — Google only writes forward from
  # the day the export is enabled.
  lifecycle {
    prevent_destroy = true
  }
}

# The stations service's GCP identity. Its only power is reading the billing
# export — jobUser to run the query, dataViewer scoped to the one dataset.
resource "google_service_account" "lore_stations" {
  count = var.enable_gcp_billing_export ? 1 : 0

  account_id   = "lore-stations"
  display_name = "Lore stations — reads the Cloud Billing BigQuery export"
}

resource "google_project_iam_member" "lore_stations_bq_jobs" {
  count = var.enable_gcp_billing_export ? 1 : 0

  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.lore_stations[0].email}"
}

resource "google_bigquery_dataset_iam_member" "lore_stations_billing_reader" {
  count = var.enable_gcp_billing_export ? 1 : 0

  project    = var.project_id
  dataset_id = google_bigquery_dataset.billing_export[0].dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.lore_stations[0].email}"
}

# Workload Identity: the helm-managed KSA lore-stations/lore-stations
# impersonates this SA, so the pod carries no key file.
resource "google_service_account_iam_member" "lore_stations_wi" {
  count = var.enable_gcp_billing_export ? 1 : 0

  service_account_id = google_service_account.lore_stations[0].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[lore-stations/lore-stations]"
}
