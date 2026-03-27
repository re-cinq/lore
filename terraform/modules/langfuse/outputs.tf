output "langfuse_url" {
  description = "Public URL for the Langfuse UI."
  value       = "https://${var.langfuse_domain}"
}

output "connection_name" {
  description = "Cloud SQL instance connection name."
  value       = "${var.project_id}:${var.region}:${google_sql_database_instance.langfuse.name}"
}

output "instance_ip" {
  description = "Private IP address of the Cloud SQL instance."
  value       = google_sql_database_instance.langfuse.private_ip_address
}
