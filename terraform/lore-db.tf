# --------------------------------------------------------------------------
# lore-db — CloudNativePG PostgreSQL + pgvector
#
# Provisions the full CNPG stack:
#   - cnpg-system namespace + CNPG operator Helm release
#   - barman-cloud plugin Helm release (replaces deprecated barmanObjectStore)
#   - lore-db namespace + credentials secrets
#   - GCS backup bucket (lore-db-backups-<project>) with 7-day lifecycle
#   - lore-db-backup GCP SA + roles/storage.objectAdmin + WI binding
#   - barman-cloud ObjectStore CR
#   - CNPG Cluster CR (1 instance, 50Gi, pgvector)
#   - ScheduledBackup CR (daily 02:00 UTC, method: plugin)
#
# Schema DDL (extensions, chunks tables, indexes) is applied separately
# by scripts/infra/setup-db.sh after the cluster is ready.
# --------------------------------------------------------------------------

module "lore_db" {
  source = "./modules/lore-db"

  project_id            = var.project_id
  region                = var.region
  db_password           = var.db_password
  backup_retention_days = 7
}
