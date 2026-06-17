# Data Model: Smart Feature Planning

## Persistence — `lore` schema (migration `0017_feature_planning.sql`)

Tables live in the `lore` schema (owned unconditionally by the migration runner
`lore`), so `CREATE`/`GRANT`/FK never hit the `must be owner` wall. See
`specs/7-feature-planning/spec.md` FR-9 and the migration's header for the
single-transaction / idempotency rules.

### `lore.features`

The lifecycle home and draft store. `path` (`specs/<slug>`) is the join key
against the computed Dgraph Feature node (graph integration, FR-8).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `DEFAULT gen_random_uuid()` (core PG13+) |
| `repo` | `text` | `owner/repo`, matches `lore.repos.full_name` |
| `title` | `text` | |
| `slug` | `text` | slugified title; `specs/<slug>/` on finalize |
| `path` | `text` | `specs/<slug>` — graph join key |
| `original_prompt` | `text` | the author's seed prompt |
| `status` | `text` | CHECK: `draft`, `planning`, `awaiting-input`, `spec-ready`, `pr-open`, `implemented`, `split` |
| `current_iteration` | `int` | |
| `draft_spec_md` | `text` | working spec, uncommitted until finalize |
| `parent_feature_id` | `uuid` | `REFERENCES lore.features(id)` (split linkage) |
| `spec_path` | `text` | set on finalize |
| `spec_pr_url` / `spec_pr_number` | `text` / `int` | |
| `issue_number` / `issue_url` | `int` / `text` | user-story Issue, if created |
| `created_by` | `text` | |
| `created_at` / `updated_at` | `timestamptz` | |

`UNIQUE (repo, slug)`. Indexes: `(repo, updated_at desc)`, `(repo, status)`, `(parent_feature_id)`.

### `lore.feature_iterations`

One row per planning round, 1:1 with the planning task/pod.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `feature_id` | `uuid` | `REFERENCES lore.features(id) ON DELETE CASCADE` |
| `iteration` | `int` | |
| `task_id` | `uuid` | **plain UUID, no FK** (soft ref to `pipeline.tasks`) |
| `status` | `text` | `running`, `ready`, `failed` |
| `user_answers` | `jsonb` | feedback that *seeded* this round (shape below) |
| `gap_result` | `jsonb` | the `GapResult` the pod POSTed (shape below) |
| `created_at` / `updated_at` | `timestamptz` | |

`UNIQUE (feature_id, iteration)`.

## `user_answers` JSONB

```jsonc
{
  "sections": {
    "architecture": { "comment": "…", "direction": "refine" },   // keep | refine | redirect
    "user_flows":   { "comment": "…", "direction": "keep" }
  },
  "questions": { "<questionId>": "answer text" },
  "free_form": "anything else the author wants to steer"
}
```

## `GapResult` contract (`libs/shared/src/feature-planning/gap-result.ts`)

Wire shape (snake_case), validated by `gapResultSchema` (Zod), parsed by
`parseGapResult`. `sanitizeSvg` runs over each mockup before persistence;
`decideFeatureStatus` maps a result to `awaiting-input` (questions/split present)
or `spec-ready`.

```jsonc
{
  "architecture": { "summary": "…", "components": [ { "name": "…", "responsibility": "…", "touchpoints": ["…"] } ] },
  "user_flows":   [ { "name": "…", "steps": ["…"] } ],
  "mockups":      [ { "title": "…", "format": "svg", "markup": "<svg …>…</svg>" } ],
  "questions":    [ { "id": "q1", "question": "…", "why": "…", "kind": "text", "options": ["…"] } ],
  "split_suggestion": { "rationale": "…", "proposed_features": [ { "title": "…", "scope": "…" } ] },
  "draft_spec_markdown": "# Feature Specification: …"
}
```

## Project port types (`libs/shared/src/project/features/`)

`FeaturesPort` (interface) + `Feature` / `Iteration` value types, backed by
`PgFeatures` (Postgres adapter over the tables above) and exposed through the
`Features` facade as `project.features`.
