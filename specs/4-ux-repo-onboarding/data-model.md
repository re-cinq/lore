# Data Model: UX Redesign + Repo Onboarding

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | UX Redesign + Repo Onboarding               |
| Branch         | 4-ux-repo-onboarding                        |
| Created        | 2026-03-29                                  |

## Schema: `lore`

New schema in PostgreSQL (CNPG). Separate from `pipeline`, `memory`,
and `org_shared`. Holds platform-level operational data.

Setup script: `scripts/infra/setup-repos-schema.sh`

## Entity: Repo

The central entity for this feature. Represents a GitHub repository
that has been discovered via the GitHub App installation and
optionally onboarded into Lore.

### Table: `lore.repos`

| Field               | Type         | Constraints                                  |
|---------------------|--------------|----------------------------------------------|
| id                  | UUID         | PK, DEFAULT gen_random_uuid()                |
| owner               | TEXT         | NOT NULL                                     |
| name                | TEXT         | NOT NULL                                     |
| full_name           | TEXT         | UNIQUE NOT NULL — format: `owner/name`       |
| team                | TEXT         | nullable                                     |
| onboarded_at        | TIMESTAMPTZ  | DEFAULT now()                                |
| last_ingested_at    | TIMESTAMPTZ  | nullable                                     |
| onboarding_pr_url   | TEXT         | nullable                                     |
| onboarding_pr_merged| BOOLEAN      | DEFAULT false                                |
| settings            | JSONB        | nullable                                     |

### Indexes

| Name                        | Columns     | Type   | Notes                        |
|-----------------------------|-------------|--------|------------------------------|
| repos_pkey                  | id          | PK     | Primary key                  |
| repos_full_name_unique      | full_name   | UNIQUE | One row per repo             |
| repos_owner_idx             | owner       | BTREE  | Filter by org/owner          |
| repos_team_idx              | team        | BTREE  | Filter by team               |

### DDL

```sql
CREATE SCHEMA IF NOT EXISTS lore;

CREATE TABLE lore.repos (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner                TEXT NOT NULL,
    name                 TEXT NOT NULL,
    full_name            TEXT UNIQUE NOT NULL,
    team                 TEXT,
    onboarded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ingested_at     TIMESTAMPTZ,
    onboarding_pr_url    TEXT,
    onboarding_pr_merged BOOLEAN NOT NULL DEFAULT false,
    settings             JSONB,

    CONSTRAINT full_name_format CHECK (full_name = owner || '/' || name)
);

CREATE INDEX repos_owner_idx ON lore.repos (owner);
CREATE INDEX repos_team_idx ON lore.repos (team);
```

### Settings JSONB Structure

The `settings` column stores per-repo configuration as JSONB. Schema
is advisory (validated at the application layer, not by PostgreSQL
constraints).

```jsonc
{
  // Which task types are available for this repo
  "task_types": ["feature", "bugfix", "refactor", "spec"],

  // Ingestion configuration
  "ingestion": {
    "schedule": "nightly",       // "nightly" | "weekly" | "manual"
    "include_paths": [],         // glob patterns to include (empty = all)
    "exclude_paths": [           // glob patterns to exclude
      "node_modules/**",
      "vendor/**",
      "dist/**"
    ]
  },

  // Eval configuration for this repo
  "eval": {
    "pass_rate": 0.85,           // PromptFoo pass threshold
    "eval_suite": "default"      // eval suite name
  }
}
```

## State Machine

A repo progresses through four states. The state is derived from
column values (not stored as an explicit column) to avoid state
synchronization bugs.

```
discovered → onboarding-pr-created → onboarded → active
```

### State Derivation

| State                  | Condition                                                        |
|------------------------|------------------------------------------------------------------|
| discovered             | Row exists, `onboarding_pr_url` IS NULL                         |
| onboarding-pr-created  | `onboarding_pr_url` IS NOT NULL, `onboarding_pr_merged` = false |
| onboarded              | `onboarding_pr_merged` = true, `last_ingested_at` IS NULL       |
| active                 | `onboarding_pr_merged` = true, `last_ingested_at` IS NOT NULL   |

### State Transitions

```
                    onboard_repo()
  discovered ──────────────────────► onboarding-pr-created
                                            │
                                  PR merged (webhook/poll)
                                            │
                                            ▼
                                       onboarded
                                            │
                                  first ingestion completes
                                            │
                                            ▼
                                         active
```

### SQL Helper View

```sql
CREATE VIEW lore.repos_with_status AS
SELECT
    *,
    CASE
        WHEN onboarding_pr_url IS NULL THEN 'discovered'
        WHEN onboarding_pr_merged = false THEN 'onboarding-pr-created'
        WHEN last_ingested_at IS NULL THEN 'onboarded'
        ELSE 'active'
    END AS status,
    CASE
        WHEN last_ingested_at IS NULL THEN 'gray'
        WHEN last_ingested_at > now() - INTERVAL '24 hours' THEN 'green'
        WHEN last_ingested_at > now() - INTERVAL '7 days' THEN 'yellow'
        ELSE 'red'
    END AS freshness
FROM lore.repos;
```

## Relationships to Existing Schemas

### `pipeline.tasks`

Pipeline tasks reference repos by `full_name` (TEXT). No foreign key
constraint across schemas — the pipeline may have tasks for repos
that were later removed.

Query: tasks for a repo.
```sql
SELECT * FROM pipeline.tasks
WHERE repo = 'owner/name'
ORDER BY created_at DESC;
```

### `memory.chunks`

Memory chunks are scoped to repos via a `source_repo` TEXT field.

Query: context for a repo.
```sql
SELECT * FROM memory.chunks
WHERE source_repo = 'owner/name'
ORDER BY created_at DESC;
```

### `org_shared.context`

Org-wide context is not repo-scoped. It is shared across all repos.
No join needed.

## Access Patterns

| Query                          | Frequency   | Index Used             |
|--------------------------------|-------------|------------------------|
| List all repos                 | High (home) | Full scan (small table)|
| Get repo by full_name          | High        | repos_full_name_unique |
| List repos by owner            | Medium      | repos_owner_idx        |
| List repos by team             | Medium      | repos_team_idx         |
| Get repos needing ingestion    | Nightly     | Full scan + filter     |
| Count tasks per repo           | High (home) | pipeline.tasks index   |

The `lore.repos` table is expected to be small (tens to low hundreds
of rows). Full table scans are acceptable for list operations. Indexes
are added for filtered queries and to enforce uniqueness.

## Migration Strategy

1. Run `scripts/infra/setup-repos-schema.sh` to create the `lore`
   schema and `repos` table.
2. No data migration needed — the table starts empty.
3. Repos are populated as users onboard them through the UI.
4. Optionally, seed existing repos by running the GitHub App
   installation list and inserting rows with `discovered` state.
