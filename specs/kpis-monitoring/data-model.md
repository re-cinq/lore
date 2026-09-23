# Data Model: KPI Monitoring

KPI definitions live as a JSONB column on `lore.plans`; measured values land in a
new `pipeline.feature_kpi_snapshots` table. The plan is the anchor — a KPI must
belong to a plan (FR-1). `lore.features` was dropped in migration 0088; every
reference to the old features table is replaced by `lore.plans`.

## `lore.plans.success_criteria` — KPI definitions (added column)

A nullable `JSONB` column added to the existing `lore.plans` table by migration
`NNNN_feature_kpis.sql`. No default; null means "no KPIs defined".

Each element of the array:

| Field | Type | Notes |
|---|---|---|
| `kpiId` | UUID string | Stable identifier, minted at authoring time |
| `metric` | string | Human-readable label |
| `queryKey` | string | One of the supported library keys |
| `direction` | `"up"` \| `"down"` | Whether the metric should increase or decrease |
| `targetValue` | number | The target the metric should reach |
| `window` | number | Rolling measurement window in days (default 30) |
| `rationale` | string? | Optional prose |

## `pipeline.feature_kpi_snapshots` — measured values

One row per `(plan_id, kpi_id, snapshot_kind, measured_at)`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `plan_id` | UUID → `lore.plans` | ON DELETE CASCADE |
| `kpi_id` | TEXT | The `kpiId` from `success_criteria` |
| `query_key` | TEXT | Denormalised for query convenience |
| `snapshot_kind` | TEXT | `baseline`, `post_merge`, or `nightly` |
| `measured_at` | TIMESTAMPTZ | When the query ran |
| `value` | NUMERIC | The measured value |
| `window_days` | INT | The window used for this measurement |
| `metadata` | JSONB | Optional diagnostics (row counts, query ranges) |

Indexes:

- `(plan_id, kpi_id, measured_at DESC)` — Goals card reads per-KPI latest value
- `(measured_at DESC)` — analytics aggregate scans

No foreign key on `kpi_id`: the JSONB source of truth is the plan; snapshot rows
are orphaned gracefully if a KPI is removed from the plan (not exposed in the UI).

## Migration

`NNNN_feature_kpis.sql` — one migration file containing:

1. `ALTER TABLE lore.plans ADD COLUMN IF NOT EXISTS success_criteria JSONB;`
2. `CREATE TABLE IF NOT EXISTS pipeline.feature_kpi_snapshots (…)` with the
   indexes above.

Applied by the Helm pre-upgrade hook on the next deploy. The column addition is
non-destructive (nullable, no default); the new table is empty until the first
approved plan triggers baseline capture.

## Where baseline and measurement results live

The approved plan's `kpiId` values are the join key. The Goals card's API
(`GET /api/plans/:id/kpis`) fetches:

- `lore.plans.success_criteria` — the definitions
- The single row in `pipeline.feature_kpi_snapshots` with `snapshot_kind =
  'baseline'` for each `kpi_id` — the at-approval value
- The most recent row in `pipeline.feature_kpi_snapshots` where `snapshot_kind !=
  'baseline'` for each `kpi_id` within the KPI's `window_days` — the latest reading

All in one query via a `LATERAL` or `DISTINCT ON` pattern; no N+1.
