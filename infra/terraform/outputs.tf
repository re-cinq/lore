output "mcp_api_url" {
  value = var.lore_api_url
}

output "ui_url" {
  value = var.lore_ui_url
}

output "webhook_url" {
  description = "Point repo webhooks here: the public webhook URL, served by lore-api."
  value       = var.lore_event_router_hostname != "" ? "https://${var.lore_event_router_hostname}/api/events" : ""
}

output "log_bucket" {
  value = google_storage_bucket.task_logs.name
}
