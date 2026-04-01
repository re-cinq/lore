# Data Model Changes for PR State Tracking

## New Table: `pull_requests`

Tracks pull request state and metadata for display in the UI.

```sql
CREATE TABLE pull_requests (
  id BIGSERIAL PRIMARY KEY,
  repo_id BIGINT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  github_pr_number INT NOT NULL,
  github_pr_id BIGINT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  state VARCHAR(20) NOT NULL, -- 'open', 'closed', 'merged'
  merged_at TIMESTAMP,
  closed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  url TEXT NOT NULL,
  
  -- Link to the task that created this PR
  pipeline_task_id BIGINT REFERENCES pipeline_tasks(id) ON DELETE SET NULL,
  
  UNIQUE(repo_id, github_pr_number)
);

CREATE INDEX idx_pull_requests_repo_id ON pull_requests(repo_id);
CREATE INDEX idx_pull_requests_state ON pull_requests(state);
CREATE INDEX idx_pull_requests_pipeline_task_id ON pull_requests(pipeline_task_id);
```

## New Table: `issues`

Tracks linked GitHub Issues for PRs and tasks (already mentioned in README but needs explicit schema).

```sql
CREATE TABLE issues (
  id BIGSERIAL PRIMARY KEY,
  repo_id BIGINT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  github_issue_number INT NOT NULL,
  github_issue_id BIGINT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  state VARCHAR(20) NOT NULL, -- 'open', 'closed'
  closed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  url TEXT NOT NULL,
  
  -- Link to the task that created this issue
  pipeline_task_id BIGINT REFERENCES pipeline_tasks(id) ON DELETE CASCADE,
  
  -- Link to the PR this issue tracks
  pull_request_id BIGINT REFERENCES pull_requests(id) ON DELETE SET NULL,
  
  UNIQUE(repo_id, github_issue_number)
);

CREATE INDEX idx_issues_repo_id ON issues(repo_id);
CREATE INDEX idx_issues_state ON issues(state);
CREATE INDEX idx_issues_pipeline_task_id ON issues(pipeline_task_id);
CREATE INDEX idx_issues_pull_request_id ON issues(pull_request_id);
```

## Modified Table: `pipeline_tasks`

Add columns to track created PR and issue:

```sql
ALTER TABLE pipeline_tasks
ADD COLUMN pull_request_id BIGINT REFERENCES pull_requests(id) ON DELETE SET NULL,
ADD COLUMN github_issue_id BIGINT REFERENCES issues(id) ON DELETE SET NULL;

CREATE INDEX idx_pipeline_tasks_pull_request_id ON pipeline_tasks(pull_request_id);
CREATE INDEX idx_pipeline_tasks_github_issue_id ON pipeline_tasks(github_issue_id);
```

## Migration Notes

1. **Backfill existing tasks**: For any existing pipeline tasks with a PR URL in their output/notes, parse the PR number and create corresponding entries in `pull_requests` and `issues` tables.

2. **GitHub App integration**: Update the Lore Agent service (`agent/src/github.ts`) to:
   - Create a `pull_requests` record when calling `gh pr create`
   - Create an `issues` record when creating a GitHub Issue for task tracking
   - Link them via `pull_request_id` and `pipeline_task_id`
   - Update PR state weekly via GitHub API polling or webhook

3. **UI layer**: The Web UI can now query PR state directly:
   ```sql
   SELECT pt.*, pr.state, pr.merged_at, pr.url, i.state as issue_state
   FROM pipeline_tasks pt
   LEFT JOIN pull_requests pr ON pt.pull_request_id = pr.id
   LEFT JOIN issues i ON pt.github_issue_id = i.id
   WHERE pt.repo_id = $1
   ORDER BY pt.created_at DESC;
   ```

4. **State sync**: Add a scheduled job to the agent scheduler (every 6 hours) to fetch latest PR state from GitHub API and update the `state`, `merged_at`, `closed_at` columns.