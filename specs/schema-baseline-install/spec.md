# Feature Specification: Baseline Schema Installs Itself

| Field   | Value                                                          |
|---------|----------------------------------------------------------------|
| Feature | Baseline Schema Installs Itself                                |
| Status  | Draft                                                          |
| Created | 2026-11-17                                                     |
| Owner   | Platform Engineering                                           |
| Module  | `deploy/chart/charts/ui-helm/baseline`, `deploy/chart/charts/ui-helm/files/migrate.sh` |

The first `helm install` against a managed Postgres (Azure Database for PostgreSQL Flexible Server) builds Lore's whole schema itself. There is no pod to `kubectl exec` into and no superuser, only the role `lore` that owns the database `lore`. Issue #3904.

## One copy of the baseline

The baseline schema is the files `deploy/chart/charts/ui-helm/baseline/NN_<name>.sql`, applied in name order: the `vector` extension, repos, pipeline, agent, memory, dark factory, then the team chunk schemas.

Every baseline file is idempotent and runs both as the bootstrap superuser and as the role `lore` on its own objects.

The `scripts/infra/setup-*.sh` scripts hold no SQL of their own: they pipe the baseline files to `psql` through `kubectl exec`.

The team schemas the baseline creates are a list given to `07_team_chunks.sql` as the psql variable `team_schemas`: five names from `setup-db.sh` and `setup-local-schema.sh`, and the chart value `migrations.teamSchemas` (`org_shared` by default) from the hook.

`scripts/check-bootstrap-columns.mjs` fails a column a baseline file adds that no incremental migration adds too.

## The hook installs it

The migrations hook Job runs `deploy/chart/charts/ui-helm/files/migrate.sh`; on a database that has no baseline it applies the baseline files as the connecting role before the incremental migrations, each file in one transaction with its own progress row `0000_baseline/<file>` in `lore.schema_migrations`.

After the last file the hook records the marker `0000_baseline`; a database with the marker, or one provisioned by the setup scripts (it has `pipeline.tasks` and no progress row), never gets the baseline.

A baseline that stopped midway resumes after the last file that committed on the next run.

When the server refuses `CREATE EXTENSION vector` to the role, the hook stops and prints the one statement a server admin runs, `CREATE EXTENSION IF NOT EXISTS vector;` in database `lore`, and the next `helm upgrade --install` continues from there.

The baseline files and the migrations are two ConfigMaps (`<chart>-baseline` and `<chart>-migrations`) with the same hook annotations, mounted at `/baseline` and `/migrations`.

`scripts/infra/setup-local-schema.sh` runs the same `migrate.sh` for its migration loop, so CI and the cluster take one path.

## Proof in CI

The `fresh-install` job of `.github/workflows/migrations.yml` runs `scripts/ci/compare-baseline-install.sh` three ways: the extension created by an admin, the extension left to the role, and a first run that breaks in `05_memory.sql` and is then resumed. Each ends with `pg_dump --schema-only --no-owner --no-privileges` of the hook-built database equal to that of a database built by `setup-local-schema.sh` with `org_shared` as the only team schema, and a second hook run that applies nothing.
