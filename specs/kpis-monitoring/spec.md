# Feature Specification: KPI Monitoring

| Field   | Value                    |
| ------- | ------------------------ |
| Feature | KPI Monitoring           |
| Branch  | kpis-monitoring          |
| Status  | Draft                    |
| Created | 2026-09-23               |
| Owner   | Platform Engineering     |

KPI Monitoring adds a structured success-criteria layer on top of the existing
feature lifecycle: the PM authors measurable KPI definitions at planning time, a
baseline is snapshotted when the plan is approved, periodic measurements run
against existing query surfaces (no new data collection), and a Goals card on the
plan page answers "are we there yet?" in under 60 seconds — all from signals Lore
already records.

## Problem Statement

Every plan has a "Success Criteria" section in prose — but once a plan's spec
transitions to `Implemented`, the connection between the feature and the numbers it
was meant to move is broken. The team must hand-query `pipeline.audit_log` and
`lore.repos.outcome_stats` to reconstruct an answer. That query takes roughly
30 minutes; a PM should be able to read the answer in under 60 seconds.

Three signals are already recorded and derivable without any new instrumentation:
`task_merge_rate` (from `pipeline.tasks`), `auto_merge_rate` (from
`pipeline.audit_log`'s `auto_merge_decision` events), and `retrieval_p95` (from
the retrieval latency logs). None of them are linked to the feature that was
supposed to move them.

## Functional Requirements

### FR-1: KPI definitions on plans

A plan carries structured success criteria as a `success_criteria` JSONB column on
`lore.plans`. Each element of the array is a KPI definition object:

- `kpiId` — stable UUID, minted at authoring time and never changed, so snapshot
  rows can reference it across edits
- `metric` — human-readable label
- `queryKey` — one of the supported query keys from the initial library
  (`task_merge_rate`, `auto_merge_rate`, `retrieval_p95`); unknown keys are
  rejected at write time
- `direction` — `up` or `down`
- `targetValue` — the number or percentage the metric should reach
- `window` — measurement window in days (default 30); stored in the JSONB so it
  can be changed without a migration
- `rationale` — optional prose

A plan with no `success_criteria` column (null) is valid; the Goals card renders a
"no KPIs defined" empty state in that case.

### FR-2: KPI authoring in the `/lore-feature` plan step

The planning agent proposes KPI definitions from the spec's prose "Success
Criteria" section during the planning line's `analyse-specs` pass. Proposals are
written into the plan's `success_criteria` JSONB via the existing plan-file
mechanism; the PM accepts, edits, or rejects each proposal before approval, using
the same section-Refine flow the rest of the plan uses.

- The planning agent's prompt (`libs/shared/src/agent-defaults/feature-planning.md`
  or the org-level override) must instruct it to read the plan's "Success Criteria"
  section and propose structured KPI definitions with `queryKey` values from the
  supported library.
- A KPI proposal whose `queryKey` is not in the supported library is stripped before
  it reaches the plan.

### FR-3: Baseline capture at plan approval

When `lore.plans.status` transitions to `approved`, the Floor's planning
acceptance handler (`apps/floor/src/work/assembly-run/feature-planning-acceptance.ts`)
fires a `feature.kpi.baseline` event for each KPI in the plan's `success_criteria`
array. The event handler queries the current value of each KPI using the same
measurement logic as FR-4 and writes one row per KPI to
`pipeline.feature_kpi_snapshots` with `snapshot_kind = 'baseline'`.

- A plan with no `success_criteria` (null or empty array) produces no baseline rows.
- Baseline capture is fire-and-forget: a measurement failure logs a warning but
  does not fail the approval.
- Mirrors the pattern of `apps/floor/src/work/dark-factory/dark-factory-baseline.ts`.

### FR-4: Measurement cron and post-merge snapshots

KPI snapshots are written on two triggers, both in the Floor process:

**Post-merge** — when a PR merges to the owning repo's main branch, the Floor's
merge handler fires a `feature.kpi.post_merge` event. The handler resolves which
plans in `lore.plans` are `approved` for that repo, queries the confirmed metric
keys, and writes rows to `pipeline.feature_kpi_snapshots` with
`snapshot_kind = 'post_merge'`.

**Nightly cron** — a `cron.feature_kpi_snapshots.tick` event runs nightly in the
Floor's main loop alongside `gap_detection` and `spec_coverage_backfill`. It scans
all `approved` plans across all repos, runs the same snapshot queries, and writes
rows with `snapshot_kind = 'nightly'`.

Both paths share one measurement function per query key (see §Query-key library).
No new container image or process is needed.

### FR-5: Query-key library

The initial library contains three deterministic query keys:

| Key | Description | Source tables |
|---|---|---|
| `task_merge_rate` | Fraction of tasks whose PRs merged in the measurement window | `pipeline.tasks` outcome fields |
| `auto_merge_rate` | Fraction of auto-merge decisions that resulted in a merge | `pipeline.audit_log` where `event_type = 'auto_merge_decision'` |
| `retrieval_p95` | p95 latency (ms) of `lore_search_memory` calls | `memory.audit_log` where `tool = 'lore_search_memory'` and `latency_ms IS NOT NULL` |

All three derive from tables that already exist. New keys are addable by extending
the library function without a migration; the `queryKey` value stored in JSONB
is the extension point.

### FR-6: Goals card on the plan detail page

A "Goals" card appears on the plan detail page
(`/repos/:owner/:repo/plans/:id`) when the plan has at least one KPI in its
`success_criteria`. The card follows the container/presentational pattern of
`apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/`.

- Each KPI row shows: metric label, direction badge, target value, baseline value
  (from the `baseline` snapshot row if one exists, else "—"), and latest measured
  value (the most recent non-baseline snapshot within the window, else "—").
- A "No KPIs defined" empty state is shown when `success_criteria` is null or empty.
- The card is visible to anyone who can read the plan (same access as the plan
  page itself — no additional scope required).
- The card fetches via a new `GET /api/plans/:id/kpis` route that returns the
  KPI definitions together with their baseline and latest snapshot values in a
  single response.

### FR-7: Feature Goal Achievement section on `/analytics`

A "Feature Goal Achievement" section is added to the global `/analytics` page,
following the stat-card pattern from `specs/retrieval-benchmarks`.

- A stat card shows the fraction of approved plans that have at least one KPI
  definition.
- A stat card shows the fraction of KPI definitions that have been auto-measured
  (have a non-baseline snapshot row) at least once.
- An empty state ("No KPI data yet") is shown when no approved plans exist.

### FR-8: API surface

New routes in `apps/lore-api/src/transport/routes/plans/`:

- `GET /api/plans/:id/kpis` — returns the plan's KPI definitions with their
  baseline and latest measured snapshot values. `read` scope.
- `PUT /api/plans/:id/kpis` — replaces the plan's `success_criteria` JSONB.
  `write` scope. Validates that every `queryKey` is in the supported library and
  that every `kpiId` is a valid UUID. Refused on an approved plan once spec-work
  has started (the baseline has already been snapshotted).
- `GET /api/analytics/kpi-summary` — returns the two aggregate fractions used by
  the `/analytics` Goals card. `read` scope.

`openapi.json` must be regenerated after these routes land so
`apps/web-ui/src/lib/api/schema.d.ts` stays in sync. The `lore/no-sql-in-web-ui`
lint rule prohibits direct Postgres access from web-ui.

## Out of Scope

- Custom query builders or arbitrary SQL per KPI.
- Real-time / streaming KPI measurement. Snapshots are nightly-cron and
  post-merge only.
- KPIs for repos that Lore manages but whose metrics are not in Lore's own
  database.
- Alerting or threshold breach notifications.
- Retroactive baseline capture for plans that were approved before this feature
  ships.
- A Prometheus endpoint exposing these metrics (see Open Questions).
- `issue_open_rate` and `review_iteration_count` in the initial library.

## Success Criteria

1. 80% of approved plans have ≥ 1 measured KPI by 2026-Q4.
2. A team member can answer "did feature X hit its goal?" in < 60 s by opening the
   plan page and reading the Goals card — no Postgres query required.
3. 70% of defined KPIs are auto-measured (have at least one non-baseline snapshot)
   by 2026-Q4.

## Open Questions

**Measurement window** — The default 30-day rolling window stored in each KPI's
JSONB `window` field is a practical starting point; the plan had no final answer
here. A configurable per-KPI window is in scope; a global setting is not needed
for v1.

**KPI editability after approval** — The plan raised the question of whether KPI
definitions should be editable after a plan ships. FR-8 (`PUT /api/plans/:id/kpis`)
refuses writes once spec-work has started, preserving the baseline contract. Before
that transition, edits are allowed. A future follow-on can add an explicit "lock
KPIs after baseline" setting.

**Prometheus direction** — The plan's open questions (q\_86f83c5f,
q\_9b181b96) pointed toward KPIs as Prometheus metrics with feature/category
labels, with Lore hosting or providing a Prometheus endpoint. This is a
significant architectural alternative to the SQL-cron snapshot model specified
here. The two models are not equivalent: Prometheus is pull-based and stateless;
the snapshot table is push-based and historically queryable. A Prometheus export
of the snapshot table (an `/api/metrics` endpoint the operator scrapes) would let
both co-exist without duplicating the measurement logic, but the naming convention,
label schema, and endpoint placement are unresolved. Deferred to a follow-on once
the measurement layer exists.
