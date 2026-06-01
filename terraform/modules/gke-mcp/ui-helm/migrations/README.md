# Schema migrations

Incremental, ordered DDL applied to the `lore-db` (CNPG) database on **every
Helm deploy** of this chart, via a `pre-install,pre-upgrade` hook Job
(`templates/migrate-job.yaml`). Both deploy paths use this chart, so both run
the hook:

- GitHub Actions — `helm upgrade --install lore-ui ./terraform/modules/gke-mcp/ui-helm`
- Terraform — `helm_release.lore_ui`

Unlike the baseline `scripts/infra/setup-*-schema.sh` scripts (run once by an
operator when first provisioning a cluster), these run on each deploy and are
tracked, so existing clusters converge without manual `kubectl exec`.

## How it runs

The hook templates a ConfigMap from every `*.sql` here, then a hook Job applies
the files not yet recorded in `lore.schema_migrations`, in filename order, each
in a single transaction. The Job re-runs every deploy (`hook-delete-policy:
before-hook-creation`); the tracking table makes already-applied migrations a
fast no-op. `helm upgrade --wait` blocks until the hook succeeds; a failing
migration fails the deploy.

The Job connects as the `postgres` superuser (DDL + `GRANT` need it) using the
chart's existing `dbPasswordSecret` — `postgres` and `lore` share the bootstrap
password (`terraform/lore-db.tf`), so no extra secret is needed. Disable with
`--set migrations.enabled=false`.

## Adding a migration

1. Create `NNNN_short_name.sql` with the next zero-padded number, in this dir.
2. Make it **idempotent** (`CREATE ... IF NOT EXISTS`, `ALTER TABLE ... ADD
   COLUMN IF NOT EXISTS`, `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL;
   END $$`). The tracking table applies each file once; idempotency keeps
   re-runs and partial states safe.
3. `GRANT` to `lore` for anything the app reads (web-ui connects as `lore`).
4. Deploy the UI chart (CI on merge to main, or `terraform apply`).
