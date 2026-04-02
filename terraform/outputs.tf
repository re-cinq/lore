output "mcp_api_url" {
  value = "https://lore-api.gcp.re-cinq.com"
}

output "ui_url" {
  value = "https://lore.gcp.re-cinq.com"
}

output "webhook_url" {
  value = "https://lore-api.gcp.re-cinq.com/api/webhook/github"
}

output "log_bucket" {
  value = google_storage_bucket.task_logs.name
}
