# --------------------------------------------------------------------------
# Outputs for the Langfuse module
# --------------------------------------------------------------------------

# ----- Langfuse URL -----

output "langfuse_url" {
  description = "Public URL for the Langfuse UI."
  value       = "https://${var.langfuse_domain}"
}

# ----- Cloud SQL -----

output "connection_name" {
  description = "Cloud SQL instance connection name (project:region:instance)."
  value       = local.cloud_sql_connection
}

output "instance_ip" {
  description = "Private IP address of the Cloud SQL instance."
  value       = google_sql_database_instance.langfuse.private_ip_address
}
