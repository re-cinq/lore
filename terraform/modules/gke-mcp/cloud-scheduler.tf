# --------------------------------------------------------------------------
# Cloud Scheduler jobs for automated context maintenance
# --------------------------------------------------------------------------
#
# 1. Nightly full re-index (2am daily) — delegates to Klaus via the
#    Lore MCP delegate_task endpoint. Includes instruction to hard-delete
#    stale chunks whose source files no longer exist.
#
# 2. Weekly gap detection (Monday 9am UTC) — delegates gap analysis
#    to Klaus via delegate_task. Identifies low-confidence query
#    clusters and surfaces documentation gaps.
# --------------------------------------------------------------------------

# ----- Service Account for Cloud Scheduler HTTP calls -----

resource "google_service_account" "scheduler" {
  account_id   = "lore-scheduler"
  display_name = "Cloud Scheduler SA — Lore automated jobs"
  project      = var.project_id
}

# Allow scheduler SA to read the agent token from Secret Manager
resource "google_secret_manager_secret_iam_member" "scheduler_token_access" {
  secret_id = var.lore_agent_token_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.scheduler.email}"
  project   = var.project_id
}

# ----- Nightly Full Re-Index (2am daily) -----

resource "google_cloud_scheduler_job" "nightly_reindex" {
  name        = "lore-nightly-full-reindex"
  description = "Nightly full re-index of all context sources via Klaus delegate_task. Hard-deletes stale chunks."
  project     = var.project_id
  region      = var.region
  schedule    = "0 2 * * *"
  time_zone   = "UTC"

  retry_config {
    retry_count          = 2
    min_backoff_duration = "30s"
    max_backoff_duration = "300s"
  }

  http_target {
    uri         = "${var.lore_mcp_endpoint}/mcp"
    http_method = "POST"

    headers = {
      "Content-Type" = "application/json"
    }

    body = base64encode(jsonencode({
      jsonrpc = "2.0"
      method  = "tools/call"
      id      = "scheduler-nightly-reindex"
      params = {
        name = "delegate_task"
        arguments = {
          task     = "Full re-index of all context sources. Crawl every registered repository and content source. For each source file, upsert the corresponding chunks in PostgreSQL (CNPG) (match on file_path + content_type + repo). After upsert completes, hard-delete any chunks whose source file no longer exists in the repository — do not soft-delete, remove them permanently. Report summary: total chunks upserted, total stale chunks deleted, any errors encountered."
          priority = "normal"
        }
      }
    }))

    oauth_token {
      service_account_email = google_service_account.scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }
}

# ----- Weekly Gap Detection (Monday 9am UTC) -----

resource "google_cloud_scheduler_job" "weekly_gap_detection" {
  name        = "lore-weekly-gap-detection"
  description = "Weekly gap analysis: identify low-confidence query clusters and surface documentation gaps."
  project     = var.project_id
  region      = var.region
  schedule    = "0 9 * * 1"
  time_zone   = "UTC"

  retry_config {
    retry_count          = 2
    min_backoff_duration = "30s"
    max_backoff_duration = "300s"
  }

  http_target {
    uri         = "${var.lore_mcp_endpoint}/mcp"
    http_method = "POST"

    headers = {
      "Content-Type" = "application/json"
    }

    body = base64encode(jsonencode({
      jsonrpc = "2.0"
      method  = "tools/call"
      id      = "scheduler-weekly-gap-detection"
      params = {
        name = "delegate_task"
        arguments = {
          task     = "Run gap analysis across all team schemas. Query Langfuse traces from the past 7 days where gap_candidate = true. Cluster these low-confidence queries by embedding similarity. For clusters with 3 or more occurrences, generate a gap report listing: the common query theme, affected teams, suggested content to create (ADR, runbook, or CLAUDE.md update), and priority based on query frequency. Output the report as structured markdown."
          priority = "normal"
        }
      }
    }))

    oauth_token {
      service_account_email = google_service_account.scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }
}
