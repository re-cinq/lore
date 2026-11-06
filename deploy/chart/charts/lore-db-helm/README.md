# lore-db (`lore-db-helm`)

The **database deployable** — PostgreSQL 16 + pgvector via
[CloudNativePG](https://cloudnative-pg.io), running as the `lore-db` Cluster in
the **`lore-db`** namespace. It backs everything: the `{team}.chunks` context
store, the `memory.*` agent-memory schema, and the `pipeline.*` task/event
tables. Schema-per-team isolation, HNSW indexes for vector search, GIN for
BM25 keyword search.

The split of responsibilities is unusual, so read this before editing either
half:

- **The CNPG `Cluster` itself is NOT in this chart.** It is defined in
  [`infra/terraform/lore-db.tf`](../../../../../lore-db.tf)
  (image `ghcr.io/cloudnative-pg/postgresql:16-bookworm`, barman-cloud backup
  plugin) and deployed by `terraform apply`, alongside the CNPG operator.
- **This subchart carries the operational add-ons** that must run on every
  umbrella deploy — today that is the **schema-ownership reconciler**: a
  `pre-install,pre-upgrade` hook Job (`templates/ownership-reconciler-job.yaml`)
  that hands ownership of the schemas listed in `values.yaml` (`pipeline` today)
  to the `lore` role, so the `ui-helm` migration runner can DDL them without
  superuser. Keep the schema list narrow — every entry runs `ALTER` on every
  relation in it as `postgres`.

## How schema changes reach this database

| Layer | Lives in | Runs |
| --- | --- | --- |
| Baseline DDL (roles, extensions, schemas) | `scripts/infra/setup-*.sh` | once, at bootstrap |
| Incremental migrations (`NNNN_*.sql`) | [`ui-helm/migrations/`](../ui-helm/migrations/) | every umbrella deploy, via ui-helm's hook Job — tracked in `lore.schema_migrations`, skip-if-applied |
| Ownership reconciliation | this chart | every umbrella deploy, before the migrations hook |

Baseline columns never reach an **existing** database on their own — that gap is
guarded by `scripts/check-bootstrap-columns.mjs`; incremental changes always go
in `ui-helm/migrations/`, which is append-only (editing an applied `NNNN` file
is inert on live databases).

## Boundaries

- No application code and no data-plane templates — connection env vars are
  each consumer chart's concern.
- The reconciler can be disabled (`ownershipReconciler.enabled: false`) for
  clusters where you run it manually; it is on the critical deploy path
  otherwise, so its kubectl image (`alpine/k8s`) is pinned deliberately.
