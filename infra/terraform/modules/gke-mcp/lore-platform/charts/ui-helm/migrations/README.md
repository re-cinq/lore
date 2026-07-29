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

The Job connects as `lore`, which owns the database (`terraform/lore-db.tf`
initdb `owner`), using the chart's existing `dbPasswordSecret` — the same
secret the UI connects with. Because `lore` owns its schemas, DDL and `GRANT`
need no superuser; `enableSuperuserAccess` stays at CNPG's secure default. The
only superuser step (`CREATE EXTENSION vector`) runs once at cluster bootstrap,
not here. Disable with `--set migrations.enabled=false`.

For clusters provisioned before `owner` was `lore` (where `postgres` still owns
the `lore` schema), hand the schema to `lore` once via the primary pod's local
socket — no network superuser needed. `REASSIGN OWNED BY postgres` does *not*
work (the bootstrap superuser owns system objects Postgres refuses to move), so
target the `lore` schema directly. This mirrors the fresh-cluster end state
(`lore` owns its schema) so migration `GRANT`s succeed:

```
kubectl exec -n lore-db -it lore-db-1 -c postgres -- \
  psql -d lore -c "GRANT CREATE ON DATABASE lore TO lore;" \
               -c "ALTER SCHEMA lore OWNER TO lore;" \
               -c "ALTER TABLE IF EXISTS lore.settings OWNER TO lore;"
```

## Adding a migration

1. Create `NNNN_short_name.sql` with the next zero-padded number, in this dir.
2. Make it **idempotent** (`CREATE ... IF NOT EXISTS`, `ALTER TABLE ... ADD
   COLUMN IF NOT EXISTS`, `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL;
   END $$`). The tracking table applies each file once; idempotency keeps
   re-runs and partial states safe.
3. `GRANT` to `lore` for anything the app reads (web-ui connects as `lore`).
4. Deploy the UI chart (CI on merge to main, or `terraform apply`).

### DDL inside the `pipeline` schema

`setup-pipeline-schema.sh` runs as `postgres`, so on clusters provisioned
before it grew its `ALTER … OWNER TO lore` block, `pipeline.*` was
`postgres`-owned and `lore` only had `GRANT ALL`. A migration like
`0003_job_runs_log_path.sql` that does
`ALTER TABLE pipeline.job_runs ADD COLUMN` would fail with
`must be owner of table` — `GRANT ALL` does not include ownership.

The forward fix is in `setup-pipeline-schema.sh` (new clusters bootstrap
with `lore` as the schema owner). For *existing* clusters the
`lore-db-helm` chart adds a `pre-install,pre-upgrade` Hook Job
(`templates/ownership-reconciler-job.yaml`) that runs an idempotent
ownership reconcile as `postgres` via the primary pod's local socket
(peer auth — no network superuser, no manual operator step). It re-runs
on every `terraform apply`, so a stale cluster converges automatically
on the next deploy.

### DDL outside the `lore` schema (team schemas)

The runner connects as `lore`, which owns the `lore` schema but **not** the
team chunk schemas (`payments`, `platform`, `mobile`, `data`, `org_shared`) —
those are created by the bootstrap superuser in `setup-db.sh`. A migration that
creates objects there (e.g. `0002_spec_test_links.sql`) needs two things:

- **`CREATE` on each team schema for `lore`.** Fresh clusters get this from
  `setup-db.sh` (`GRANT CREATE, USAGE ON SCHEMA … TO lore`). For clusters
  provisioned before that line, hand it over once via the primary pod's local
  socket (no network superuser):

  ```
  kubectl exec -n lore-db lore-db-1 -c postgres -- \
    psql -d lore -c "GRANT CREATE, USAGE ON SCHEMA org_shared, payments, platform, mobile, data TO lore;"
  ```

- **Schema discovery via `pg_catalog`, not `information_schema`.** The latter is
  privilege-filtered, so as `lore` it hides tables with no grant and a discovery
  loop silently creates nothing. Iterate `pg_catalog.pg_class`/`pg_namespace`.

### 0013 / 0014 — hippo-memory + audit_log backfill, and the prod drift they fix

A prod audit (2026-06-05) found the deployed code was ahead of the schema:
`memory.facts.confidence` (ADR-016 hippo-memory) was missing, so every
`searchMemories()` threw `column f.confidence does not exist` — silently dropping
**memory + episodes from all assembled context, org-wide**. `pipeline.audit_log`
(dark factory) was also absent. Both were added to the baseline setup scripts but
never backfilled onto clusters bootstrapped earlier.

- **`0014_dark_factory_audit_log.sql` self-heals on deploy.** `pipeline` is owned
  by `lore` (the runner), so the `CREATE TABLE IF NOT EXISTS pipeline.audit_log`
  applies cleanly through this channel — no operator step.

- **`0013_memory_hippo_columns.sql` cannot self-heal where `memory` is
  superuser-owned.** Like `memory.memories.repo` in 0012, the ALTERs need table
  ownership the `lore` runner lacks, so the migration catches
  `insufficient_privilege` and skips with a NOTICE. **Prod convergence is the same
  local-socket, peer-auth path used elsewhere here** (no network superuser): re-run
  the idempotent baseline — which already declares these columns — as `postgres`
  via the primary pod's socket:

  ```
  kubectl exec -n lore-db lore-db-1 -c postgres -- \
    psql -d lore -f /path/to/scripts/infra/setup-memory-schema.sql   # or pipe the script
  ```

  (Or fold the hippo ALTERs into the `ownership-reconciler-job` so it converges
  automatically on the next `terraform apply`, mirroring the ownership reconcile.)

- **`data.chunks` "permission denied" is a missing runtime grant**, not a
  migration: `lore` has `CREATE/USAGE` on the `data` team schema (above) but no
  `SELECT` on its tables. Grant it once via the same local socket:

  ```
  kubectl exec -n lore-db lore-db-1 -c postgres -- \
    psql -d lore -c "GRANT SELECT ON ALL TABLES IN SCHEMA data TO lore;
                     ALTER DEFAULT PRIVILEGES IN SCHEMA data GRANT SELECT ON TABLES TO lore;"
  ```

### 0035 — legacy org_shared chunk relocation needs a one-time DML grant

`0035_migrate_legacy_org_shared_chunks.sql` moves rows between chunk tables the
`lore` runner does not own (`org_shared.chunks` → each team schema's `chunks`),
so it needs `SELECT`/`INSERT` on the targets and `SELECT`/`DELETE` on
`org_shared` — beyond the schema-level `CREATE/USAGE` handoff above. Without
the grant the migration does **not** fail: it catches `insufficient_privilege`
per repo and skips with a `NOTICE`, leaving the legacy rows in place. **Check
the deploy log for `skip repo ... insufficient privilege` lines**; if present,
apply the grant once via the same local socket used for `data.chunks` above,
then re-apply the file by hand (the tracking table already records it, so a
redeploy will not re-run it):

```
kubectl exec -n lore-db lore-db-1 -c postgres -- \
  psql -d lore -c "GRANT SELECT, INSERT, DELETE ON ALL TABLES IN SCHEMA org_shared, payments, platform, mobile, data TO lore;"
```

The migration is idempotent (per-file dedupe guard + `ON CONFLICT (id) DO
NOTHING`), so re-running it after the grant is safe.
