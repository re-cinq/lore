# Contract: Task timeline API

Endpoint for the web-ui stage timeline view (Phase 4 Task 4.3). Reconstructs a task's lifecycle from `git log` on its branch by parsing commit trailers.

## Endpoint

### `GET /api/tasks/:uuid/timeline`

Returns the ordered list of stage commits on the task's branch.

Requires `read` scope.

**Response 200:**

```json
{
  "task_id": "7f3c4a01-8b2e-4c1d-a9f6-1234567890ab",
  "branch_name": "lore/feature/example-1234",
  "repo": "owner/repo",
  "pr_number": 1234,
  "pr_state": "open|merged|closed",
  "commits": [
    {
      "sha": "abc123",
      "stage": "implement",
      "iteration": 1,
      "node_type": "agent",
      "outcome": "success",
      "committed_at": "2026-04-28T12:00:00Z",
      "duration_ms": 47000,
      "summary": "Implements the /api/dark-factory route",
      "files_changed": 3,
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

`duration_ms` is computed from the previous commit's `committed_at` (or task creation for the first stage).

**Response 404:**
- `task_not_found` — task UUID unknown.
- `branch_not_found` — task exists but branch was deleted; response includes `last_known_state` from the audit log.

**Response 200 with degraded data:**
- If `git log` parsing fails partway, returns the commits parsed so far plus `parse_error: { commit_sha, reason }` — non-fatal.

## Reverse resolver

### `GET /api/tasks/by-pr/:owner/:repo/:pr_number`

Resolves a PR back to its task UUID. Used by web-ui when the user navigates from a GitHub PR URL.

**Response 200:**

```json
{
  "task_id": "7f3c4a01-...",
  "trailer_source": "pr_body | final_commit"
}
```

The resolver looks for `Lore-Task: <uuid>` in: (1) the PR body, (2) the final commit's trailers. PR body wins on conflict.

**Response 404:** no Lore-Task trailer found.

## Caching

- `git log` parsing on the supervisor pod's mounted volume is cheap (≤ 50 commits per branch), so no caching for v1.
- Web-ui polls every 10s while task is in-flight; stops polling once `current_stage = "retrospective"` AND `lease.held = false`.

## Failure modes

| Failure | Behavior |
|---|---|
| Branch deleted on remote | Return last cached state + `branch_deleted: true` flag; UI shows banner |
| Task has no branch yet (gate-blocked) | Return `commits: []`, `current_stage: null`, `pending: "awaiting_approval"` |
| Trailer parse failure on individual commit | Row returned with `parse_error` field; subsequent commits parsed normally |
