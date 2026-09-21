# Data Model: Planning a Feature Together

A plan lives in lore-api's database, written by `pgPlanStore` for
`@re-cinq/planning-sync` (ADR-047, migration `0087_plans.sql`). The Yjs document is
the truth; the JSON beside it is its projection (planning-station ADR-002).
`lore.features` and `lore.feature_iterations` are gone (migration
`0088_drop_features.sql`).

## `lore.plans` — one plan's workflow meta

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | the plan id every route and the planning line key on |
| `repo` | TEXT | `owner/repo` |
| `title` | TEXT | the plan's H1, renamed with it |
| `type` | TEXT | the template: `feature`, `ui-change`, `performance`, `refactor`, `incident-response` |
| `template_version` | INT | the template's version the plan was seeded from |
| `status` | TEXT | `draft`, `in-review`, `approved`, `superseded` |
| `approval` | JSONB | who approved which version, when |
| `current_version` | INT | the newest version number |
| `created_by`, `created_at`, `updated_at` | | |

## `lore.plan_state` — the live document

| Column | Type | Notes |
|---|---|---|
| `plan_id` | UUID PK → `lore.plans` | |
| `state` | BYTEA | the Yjs document |
| `json` | JSONB | the projection lore-api answers |
| `content_hash` | TEXT | unchanged content cuts no version |

## `lore.plan_versions` — every content change

Keyed `(plan_id, version)`; each row keeps the plan's `json` and Yjs `state` as
they were, with the `reason` and author of the change.

## `lore.plan_collab_tokens` — who may open the socket

Short-lived tokens lore-api mints for one person on one plan of one repo; only the
token's sha256 is stored, and a token lapses after ten minutes.

## Where the planning line keeps the rest

What used to be feature columns rides the planning line instead: the run's args
carry `plan_id`, `repo` and `plan_title` from the start and `spec_path` once the
spec analysis names it, and every spec-task the decomposition files carries
`plan_id` and `spec_path` in its `context_bundle`.
