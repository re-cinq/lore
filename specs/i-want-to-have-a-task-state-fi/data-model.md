# Task State Filter Data Model

## Overview

A task state filter in the UI requires no new database tables. The feature leverages existing task state data already tracked in the pipeline schema.

## Existing Schema (Used)

The `pipeline.pipeline_tasks` table already contains all necessary state information:

```sql
-- Existing table (no changes needed)
CREATE TABLE pipeline.pipeline_tasks (
  id UUID PRIMARY KEY,
  repo_id UUID NOT NULL REFERENCES lore.repos(id),
  task_type VARCHAR NOT NULL,
  status VARCHAR NOT NULL, -- 'pending', 'claimed', 'running', 'completed', 'failed', 'cancelled'
  title TEXT,
  description TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  completed_at TIMESTAMP,
  claimed_by UUID,
  -- ... other fields
);
```

## UI Filter Implementation

The task state filter operates entirely on the existing `status` column. Valid filter values:

| Filter Value | Maps To | Description |
|--------------|---------|-------------|
| `pending` | status = 'pending' | Awaiting agent pickup |
| `claimed` | status = 'claimed' | Assigned to agent, not yet running |
| `running` | status = 'running' | Currently executing |
| `completed` | status = 'completed' | Successfully finished |
| `failed` | status = 'failed' | Execution error, may be retried |
| `cancelled` | status = 'cancelled' | User-cancelled or TTL expired |

## Query Pattern

```sql
-- Filter example: show only running tasks for a repo
SELECT * FROM pipeline.pipeline_tasks
WHERE repo_id = $1 AND status = $2
ORDER BY updated_at DESC;
```

## No Migration Needed

- No new tables required
- No schema changes required
- No new indexes required (existing index on `(repo_id, status)` already exists in production schema)
- Filter is purely a UI layer query parameter

The web-ui can add a multi-select dropdown or pill buttons for task states, calling the existing MCP tool `list_pipeline_tasks` with the `status_filter` parameter already supported by that tool.

SKIP