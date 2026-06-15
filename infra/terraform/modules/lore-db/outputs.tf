output "cluster_name" {
  description = "Name of the PostgreSQL (CNPG) DBCluster."
  value       = "lore-db"
}

output "namespace" {
  description = "Namespace where PostgreSQL (CNPG) is deployed."
  value       = "lore-db"
}

output "service_host" {
  description = "Internal service hostname for connecting from other pods."
  value       = "lore-db-rw.lore-db.svc.cluster.local"
}

output "service_port" {
  description = "PostgreSQL port."
  value       = 5432
}
