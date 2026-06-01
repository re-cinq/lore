# Contract: Task timeline API

Endpoint for the web-ui stage timeline view (FR5.3, T048/T049). Reconstructs a
task's lifecycle by fetching the task branch's commits from the **GitHub API**
and parsing their `Lore-Stage:`/`Lore-Iteration:`/`Lore-Task:` trailers via
`parseTrailers()` (shared/src/commit-trailers.ts).

> **Note (implementation divergence from original design):** The original design
> called for parsing `git log` on the supervisor pod's mounted volume. The
> implementation uses the GitHub API instead — the branch is the authoritative
> source of truth on the remote and this avoids requiring a local git checkout
> inside the mcp-server process.

## Endpoint

### `GET /api/tasks/:uuid/timeline`

Returns the ordered list of stage commits on the task's branch.

Requires `read` scope.

**Response 200 — normal:**

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

**Commit fields:**
- `sha` — full commit SHA (client links to `github.com/{repo}/commit/{sha}`)
- `stage` — value of `Lore-Stage:` trailer (e.g. `draft`, `implement`, `validate`, `review`, `retrospective`)
- `iteration` — integer from `Lore-Iteration:` trailer
- `outcome` — value of `Lore-Outcome:` extra trailer, defaults to `"success"` if absent
- `committed_at` — committer date ISO string
- `duration_ms` — wall-clock milliseconds from the previous commit's `committed_at` (or task `created_at` for the first stage); `null` when the delta cannot be computed
- `summary` — first line of the commit message
- `extras` — all trailer key/value pairs that are not the three required keys (`Lore-Stage`, `Lore-Iteration`, `Lore-Task`)

**Omitted fields vs original design:**
- `node_type` — not emitted; the stage name itself encodes the node type
- `files_changed` — not emitted; would require an extra GitHub API call per commit

`current_stage` is the `stage` value of the most recent stage commit, or `null` when no stage commits exist yet.

**pr_state resolution:** Live-fetched via `octokit.rest.pulls.get`; `null` when `pr_number` is null or when the fetch fails (best-effort).

**Lease state:** Queried from `pipeline.task_leases WHERE branch_name = $1`. Returns `{ held: false }` when no row exists. Errors are silenced — the field is best-effort.

**Response 404:**
- `task_not_found` — task UUID unknown in `pipeline.tasks`.

**Response 200 — no branch yet (gate-blocked or not started):**

```json
{
  "task_id": "...",
  "branch_name": null,
  "repo": null,
  "pr_number": null,
  "pr_url": null,
  "pr_state": null,
  "commits": [],
  "current_stage": null,
  "pending": "no_branch"
}
```

`pending: "no_branch"` is returned whenever `target_branch` is null on the task row — this covers both gate-blocked (awaiting approval label) and tasks that have not yet reached the branch-creation stage.

**Response 200 — branch deleted on remote:**

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

Returned when the GitHub API responds with HTTP 404 for `repos.listCommits`. The `commits` array is empty; there is no `last_known_state` field. The web-ui renders a banner informing the user the branch was deleted.

**Response 503:** `database unavailable` when the DB pool is null.

**Non-stage commits:** Commits whose message does not contain a valid trailer block (all three of `Lore-Stage`, `Lore-Iteration`, `Lore-Task`) are silently skipped. No partial `parse_error` object is emitted; the response simply omits those commits.

## Reverse resolver

### `GET /api/tasks/by-pr/:owner/:repo/:pr_number`

Resolves a PR back to its task UUID. Used by web-ui when the user navigates
from a GitHub PR URL.

**Lookup order (first match wins):**

1. **DB fast-path** — `SELECT id FROM pipeline.tasks WHERE target_repo = $1 AND pr_number = $2`
2. **PR body** — fetch PR via `octokit.rest.pulls.get`; match `Lore-Task: <uuid>` in `body`
3. **Final commit** — parse `Lore-Task:` trailer from the head commit of the PR branch

**Response 200:**

```json
{
  "task_id": "7f3c4a01-...",
  "trailer_source": "db | pr_body | final_commit"
}
```

`trailer_source: "db"` is returned for the fast-path hit (not present in the original contract design).

**Response 404:**
- `no_trailer_found` — no `Lore-Task` trailer found anywhere
- `pr_not_found` — the GitHub API returned 404 for the PR

**Response 503:** `database unavailable` when the DB pool is null.

## Polling behaviour (web-ui)

`Timeline.tsx` polls every 10 s while the task is considered active:

```
stillActive = ACTIVE_STATES.has(initialStatus)
           OR (current_stage exists AND current_stage ≠ "retrospective")
```

`ACTIVE_STATES = { "pending", "running", "queued", "review" }`.

Polling stops when both conditions are false — i.e. the task status is terminal
**and** the most recent stage commit is `retrospective` (or there are no commits).
The `lease.held` flag is displayed in the UI but is not used as a polling gate.

## Failure modes

| Failure | Behaviour |
|---|---|
| Branch deleted on remote | 200 with `commits: []`, `branch_deleted: true`; web-ui shows banner |
| Task has no branch yet | 200 with `commits: []`, `current_stage: null`, `pending: "no_branch"` |
| Non-stage commits on branch | Silently skipped; not reflected in the response |
| `pipeline.task_leases` table absent | Lease field omitted (`null`) — non-fatal |
| GitHub API error (non-404) | 500 `{ error: "github_api" }` |
| PR state fetch fails | `pr_state: null` — best-effort, does not fail the response |
