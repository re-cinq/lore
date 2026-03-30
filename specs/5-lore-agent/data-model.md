# Data Model: Lore Agent Service

## Existing Entities (no changes)

### pipeline.tasks

Already exists. The agent service reads and updates this table.

| Field             | Type         | Constraints                          |
|-------------------|--------------|--------------------------------------|
| id                | UUID         | PK, DEFAULT gen_random_uuid()        |
| description       | TEXT         | NOT NULL                             |
| task_type         | TEXT         | NOT NULL, DEFAULT 'general'          |
| target_repo       | TEXT         | nullable                             |
| status            | TEXT         | NOT NULL, DEFAULT 'pending'          |
| agent_id          | TEXT         | nullable                             |
| agent_session_id  | TEXT         | nullable                             |
| pr_url            | TEXT         | nullable                             |
| pr_number         | INT          | nullable                             |
| target_branch     | TEXT         | nullable                             |
| context_bundle    | JSONB        | nullable                             |
| failure_reason    | TEXT         | nullable                             |
| review_iteration  | INT          | DEFAULT 0                            |
| created_by        | TEXT         | DEFAULT 'ui'                         |
| created_at        | TIMESTAMPTZ  | DEFAULT now()                        |
| updated_at        | TIMESTAMPTZ  | DEFAULT now()                        |

**Status transitions:**
```
pending → queued → running → pr-created → [review → merged | failed]
                           → failed
```

### pipeline.task_events

Already exists. The agent logs events here.

| Field       | Type         | Constraints                   |
|-------------|--------------|-------------------------------|
| id          | UUID         | PK                            |
| task_id     | UUID         | FK → pipeline.tasks           |
| from_status | TEXT         | nullable                      |
| to_status   | TEXT         | nullable                      |
| metadata    | JSONB        | nullable                      |
| created_at  | TIMESTAMPTZ  | DEFAULT now()                 |

## New Entities

### pipeline.llm_calls

Tracks every LLM API call for cost tracking and debugging.

| Field         | Type           | Constraints                   |
|---------------|----------------|-------------------------------|
| id            | UUID           | PK, DEFAULT gen_random_uuid() |
| task_id       | UUID           | nullable, FK → pipeline.tasks |
| job_name      | TEXT           | nullable                      |
| model         | TEXT           | NOT NULL                      |
| input_tokens  | INT            | NOT NULL                      |
| output_tokens | INT            | NOT NULL                      |
| cost_usd      | NUMERIC(10,6)  | NOT NULL                      |
| duration_ms   | INT            | NOT NULL                      |
| created_at    | TIMESTAMPTZ    | DEFAULT now()                 |

**Indexes:**
- INDEX on task_id
- INDEX on created_at
- INDEX on job_name

### pipeline.job_runs

Tracks scheduled job executions.

| Field          | Type         | Constraints                   |
|----------------|--------------|-------------------------------|
| id             | UUID         | PK, DEFAULT gen_random_uuid() |
| job_name       | TEXT         | NOT NULL                      |
| started_at     | TIMESTAMPTZ  | NOT NULL, DEFAULT now()       |
| completed_at   | TIMESTAMPTZ  | nullable                      |
| status         | TEXT         | NOT NULL, DEFAULT 'running'   |
| result_summary | TEXT         | nullable                      |
| error          | TEXT         | nullable                      |

**Indexes:**
- INDEX on job_name, started_at DESC
- INDEX on status

**Status values:** running, completed, failed

## Entity Relationships

```
pipeline.tasks 1──N pipeline.task_events
pipeline.tasks 1──N pipeline.llm_calls
pipeline.job_runs (standalone, linked to llm_calls via job_name)
pipeline.llm_calls (linked to task OR job, never both)
```

## Migration Script

New tables only — no changes to existing tables.

```sql
-- pipeline.llm_calls
CREATE TABLE IF NOT EXISTS pipeline.llm_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES pipeline.tasks(id),
  job_name TEXT,
  model TEXT NOT NULL,
  input_tokens INT NOT NULL,
  output_tokens INT NOT NULL,
  cost_usd NUMERIC(10,6) NOT NULL,
  duration_ms INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_task ON pipeline.llm_calls(task_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON pipeline.llm_calls(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_calls_job ON pipeline.llm_calls(job_name);

-- pipeline.job_runs
CREATE TABLE IF NOT EXISTS pipeline.job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  result_summary TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_runs_name ON pipeline.job_runs(job_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_status ON pipeline.job_runs(status);
```

## Feature Request Task Type

No schema changes needed. Feature requests use the existing
`pipeline.tasks` table with `task_type = 'feature-request'`. The
agent generates spec artifacts (spec.md, data-model.md, tasks.md)
and commits them to a PR — no new columns or tables required.
