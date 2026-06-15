output "cluster_name" {
  description = "Name of the GKE cluster."
  value       = google_container_cluster.main.name
}

output "cluster_endpoint" {
  description = "Endpoint of the GKE cluster API server."
  value       = google_container_cluster.main.endpoint
  sensitive   = true
}

output "cluster_ca_certificate" {
  description = "Base64-encoded CA certificate of the GKE cluster."
  value       = google_container_cluster.main.master_auth[0].cluster_ca_certificate
  sensitive   = true
}
