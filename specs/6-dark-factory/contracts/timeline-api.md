# Contract: Task timeline API

Endpoint for the web-ui stage timeline view (T048/T049, FR5.3). Reconstructs a task's lifecycle from `git log` on its branch by calling the GitHub API and parsing commit trailers.

## Endpoint

### `GET /api/tasks/:uuid/timeline`

Returns the ordered list of stage commits on the task's branch.

Requires `read` scope.

**Response 200 (normal):**

```json
{
  "task_id": "7f3c4a01-8b2e-4c1d-a9f6-1234567890ab",
  "branch_name": "lore/feature/example-1234",
  "repo": "owner/repo",
  "pr_number": 1234,
  "pr_url": "https://github.com/owner/repo/pull/1234",
  "pr_state": "open|merged|closed|null",
  "commits": [
    {
      "sha": "abc123",
      "stage": "implement",
      "iteration": 1,
      "outcome": "success",
      "committed_at": "2026-04-28T12:00:00Z",
      "duration_ms": 47000,
      "summary": "Implements the /api/dark-factory route",
      "extras": {
        "Lore-Cost-Tokens": "input=2400 output=890"
      }
    }
  ],
  "current_stage": "review",
  "lease": {
    "held": true,
    "holder": "agent-pod-xyz-123",
    "expires_at": "2026-04-28T12:10:00Z"
  }
}
```

**`TimelineCommit` fields:**

| Field | Type | Notes |
|---|---|---|
| `sha` | string | Full git SHA |
| `stage` | string | `Lore-Stage:` trailer value |
| `iteration` | number | `Lore-Iteration:` trailer value |
| `outcome` | string | `Lore-Outcome:` trailer value; defaults to `"success"` when trailer is absent |
| `committed_at` | string | ISO 8601 timestamp from committer date |
| `duration_ms` | number\|null | ms since previous commit's `committed_at`; for the first commit, measured from `pipeline.tasks.created_at`; `null` when timestamp difference is non-finite |
| `summary` | string | First line of the commit message |
| `extras` | object\|undefined | All remaining parsed trailers as a string map; present only when at least one extra trailer exists |

Commits without a `Lore-Stage:` trailer (e.g., baseline commits from before Lore took over the branch) are silently skipped. `current_stage` is the `stage` value of the last commit in the list, or `null` if no stage commits exist.

`pr_state` is fetched live from the GitHub API on each request; it is `null` when no PR is linked or when the GitHub call fails (best-effort).

`lease` is queried from `pipeline.task_leases` keyed on `branch_name`. Returns `{ "held": false }` when no row exists; omitted from the response entirely when the table is unavailable (non-fatal).

**Response 200 — no branch yet:**

Returned when `pipeline.tasks.target_branch` is NULL (task created but supervisor has not started):

```json
{
  "task_id": "...",
  "branch_name": null,
  "repo": "owner/repo",
  "pr_number": null,
  "pr_url": null,
  "pr_state": null,
  "commits": [],
  "current_stage": null,
  "pending": "no_branch"
}
```

**Response 200 — branch deleted on remote:**

Returned when the GitHub API returns 404 for the branch:

```json
{
  "task_id": "...",
  "branch_name": "lore/feature/example-1234",
  "repo": "owner/repo",
  "pr_number": 1234,
  "pr_url": "https://github.com/owner/repo/pull/1234",
  "pr_state": null,
  "commits": [],
  "branch_deleted": true
}
```

**Response 404:**
- `{ "error": "task_not_found" }` — task UUID unknown.
- `{ "error": "not found" }` — URL did not match the route pattern.

**Response 500:**
- `{ "error": "internal" }` — DB query failed.
- `{ "error": "github_api" }` — GitHub API call failed for a reason other than 404.

**Response 503:**
- `{ "error": "database unavailable" }` — DB pool not initialised.

## Reverse resolver

### `GET /api/tasks/by-pr/:owner/:repo/:pr_number`

Resolves a PR back to its task UUID. Used by web-ui when the user navigates from a GitHub PR URL.

**Lookup order:**

1. **DB fast path** — query `pipeline.tasks WHERE target_repo = $1 AND pr_number = $2`. Returns `trailer_source: "db"` on hit.
2. **PR body** — fetch PR via GitHub API; regex `Lore-Task: <uuid>` from `pr.body`. Returns `trailer_source: "pr_body"` on hit.
3. **Final commit** — read `Lore-Task:` trailer from the PR head commit. Returns `trailer_source: "final_commit"` on hit.

**Response 200:**

```json
{
  "task_id": "7f3c4a01-...",
  "trailer_source": "db | pr_body | final_commit"
}
```

**Response 404:**
- `{ "error": "no_trailer_found" }` — PR found but no `Lore-Task:` trailer anywhere.
- `{ "error": "pr_not_found" }` — GitHub returned 404 for the PR.
- `{ "error": "not found" }` — URL did not match the route pattern.

**Response 500:**
- `{ "error": "github_api" }` — GitHub API call failed.

**Response 503:**
- `{ "error": "database unavailable" }` — DB pool not initialised.

## Caching

No server-side caching. The GitHub API call for `listCommits` (≤ 100 commits per branch) is cheap enough that every request re-fetches.

Web-ui polls every 10 s while the task is active; polling continues while `current_stage != "retrospective"` OR `lease.held == true` OR `initialStatus` is one of `pending | running | queued | review`.

## Failure modes

| Failure | Behavior |
|---|---|
| Branch deleted on remote | Return 200 with `commits: []` and `branch_deleted: true`; UI shows warning banner |
| Task has no branch yet | Return 200 with `commits: []` and `pending: "no_branch"` |
| Individual commit missing trailers | Commit silently skipped; subsequent commits parsed normally |
| `task_leases` table absent | `lease` field omitted from response; non-fatal |
| PR state fetch fails | `pr_state` set to `null`; rest of response unaffected |
