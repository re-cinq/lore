output "cluster_id" {
  description = "The fully-qualified ID of the AlloyDB cluster."
  value       = google_alloydb_cluster.main.id
}

output "instance_ip" {
  description = "Private IP address of the primary AlloyDB instance."
  value       = google_alloydb_instance.primary.ip_address
}

output "connection_name" {
  description = "Connection name of the AlloyDB cluster (project:region:cluster)."
  value       = "${var.project_id}:${var.region}:${google_alloydb_cluster.main.cluster_id}"
}
