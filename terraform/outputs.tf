output "mcp_api_url" {
  value = var.lore_api_url
}

output "ui_url" {
  value = var.lore_ui_url
}

output "webhook_url" {
  value = "${var.lore_api_url}/api/webhook/github"
}

output "log_bucket" {
  value = google_storage_bucket.task_logs.name
}
