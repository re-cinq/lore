output "mcp_api_url" {
  value = var.lore_api_url
}

output "ui_url" {
  value = var.lore_ui_url
}

output "webhook_url" {
  description = "Point the GitHub App / org webhook here (the ingress moved to the Floor)."
  value       = var.lore_webhook_hostname != "" ? "https://${var.lore_webhook_hostname}/api/webhook/github" : ""
}

output "log_bucket" {
  value = google_storage_bucket.task_logs.name
}
