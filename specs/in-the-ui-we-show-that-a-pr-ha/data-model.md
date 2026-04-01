# Data Model: PR State Visibility

## No Schema Changes Required

The existing `pipeline.tasks` table already has the columns needed:

```sql
-- Already exists:
pr_url     TEXT     -- GitHub PR URL
pr_number  INTEGER  -- GitHub PR number
target_repo TEXT    -- owner/repo (e.g. "re-cinq/my-service")
```

These three columns are sufficient to query GitHub's API for live PR
state. No new tables, columns, or indexes needed.

## PR State is Computed, Not Stored

The `PRDetails` type is returned by the GitHub API route and MCP tool,
never persisted:

```typescript
interface PRDetails {
  number: number;
  title: string;
  state: string;          // GitHub's raw state: open, closed
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  html_url: string;
  checks: Array<{
    name: string;
    status: string;        // queued, in_progress, completed
    conclusion: string | null; // success, failure, neutral, etc.
  }>;
  reviews: Array<{
    user: string;
    state: string;         // APPROVED, CHANGES_REQUESTED, COMMENTED
    submitted_at: string;
  }>;
  computed_status: PRStatus;
}

type PRStatus =
  | 'draft'
  | 'open'
  | 'checks-failing'
  | 'changes-requested'
  | 'approved'
  | 'merged'
  | 'closed';
```

## Future: Optional Caching (Phase 1)

If we later need to filter/sort by PR state or track state history,
add these columns to `pipeline.tasks`:

```sql
-- Phase 1 (not now):
ALTER TABLE pipeline.tasks ADD COLUMN pr_status VARCHAR(30);
ALTER TABLE pipeline.tasks ADD COLUMN pr_last_polled TIMESTAMPTZ;
CREATE INDEX idx_tasks_pr_status ON pipeline.tasks(pr_status) WHERE pr_status IS NOT NULL;
```

Plus a polling CronJob to keep them fresh. But that's a separate spec.
