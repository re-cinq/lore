# Feature Specification: GET /api/tasks/:id/timeline

| Field      | Value                                                          |
|------------|----------------------------------------------------------------|
| Feature    | Task stage-commit timeline                                     |
| Status     | In Progress                                                    |
| Created    | 2026-06-10                                                    |
| Owner      | Platform Engineering                                          |
| Route      | `GET /api/tasks/:id/timeline`                                 |
| Auth scope | `read` (prefix `/api/tasks` → `read`)                        |
| Module     | Task timeline (`api/routes/task-timeline.ts` → `handleTaskTimeline`) |

GET /api/tasks/:id/timeline reconstructs a dark-factory task's stage-commit history from its branch trailers via the GitHub API and overlays PR and lease state, feeding the web UI Timeline view without a local checkout.

## Problem Statement

A dark-factory task records its progress as a chain of git commits, each
carrying `Lore-Stage:` / `Lore-Iteration:` / `Lore-Task:` trailers (branch-as-
state). The web UI Timeline view needs to render that chain — ordered stages,
per-stage durations, outcome badges, PR state, and the live lease holder —
without a local checkout. This endpoint resolves the task's branch from the DB,
reads the branch's commits via the GitHub API, folds the trailered commits into
an ordered timeline, and overlays PR state + lease state.

## Interface

Registered as `pattern(/^\/api\/tasks\/[^/]+\/timeline(\?|$)/, "GET")` →
`handleTaskTimeline(req, res, pool)`
([registration](../../../apps/lore-api/src/server/build-server.ts#L91),
[handler](../../../apps/lore-api/src/api/routes/tasks/task-timeline.ts#L66)). Placed
**before** the broad `prefix("/api/tasks", "GET")` list route so the timeline
regex wins.

- **Method + path**: `GET /api/tasks/:id/timeline` (`:id` is `[^/]+`, URL-decoded).
- **Auth scope**: `read`. No `SCOPE_OVERRIDES` match; first `ROUTE_SCOPES` prefix
  is `/api/tasks` → `"read"` ([scope map](../../../apps/lore-api/src/api/routes/tasks/task-timeline.ts#L70)).
  Rate-limit bucket `task` (60/min).
- **Request**: path param only; no body, no query (a `?…` suffix is tolerated by
  the matcher but ignored).

### Response shape (200)

```
{ task_id, branch_name, repo, pr_number, pr_url, pr_state,
  commits: TimelineCommit[], current_stage, lease }
```

`TimelineCommit = { sha, stage, iteration, outcome, committed_at,
duration_ms, summary, extras? }`. Degenerate 200s add `pending: "no_branch"`
(no repo/branch) or `branch_deleted: true` (GitHub 404).

| Status | When                                                               |
|--------|--------------------------------------------------------------------|
| 200    | Task found (full timeline, `no_branch`, or `branch_deleted`).      |
| 404    | Handler regex miss (`{ error: "not found" }`) or unknown task (`{ error: "task_not_found" }`). |
| 500    | DB lookup throws (`{ error: "internal" }`) or non-404 GitHub error (`{ error: "github_api" }`). |
| 503    | Pool null (`{ error: "database unavailable" }`).                  |

## Behavior

1. **Pool gate** — null pool → `503 { error: "database unavailable" }`.
2. Re-match `req.url` against the stricter `TIMELINE_RE`
   (`/^\/api\/tasks\/([^/?]+)\/timeline/`). On no match → `404 { error: "not found" }`.
   (Catches paths the dispatcher's looser regex admits, e.g. `a?b/timeline`.)
3. `taskId = decodeURIComponent(m[1])`.
4. **Task lookup** — `SELECT target_repo, target_branch, pr_number, pr_url,
   status, created_at FROM pipeline.tasks WHERE id = $1` with `[taskId]`. A thrown
   error logs `"[timeline] task lookup failed:"` → `500 { error: "internal" }`.
   No row → `404 { error: "task_not_found" }`.
5. **No-branch short circuit** — if `target_repo` or `target_branch` is falsy,
   return `200` with `commits: [], pr_state: null, current_stage: null,
   pending: "no_branch"` (branch/repo echoed as-is, may be null).
6. **Commit fetch** — split `repo` into `[owner, repoName]`; `getOctokit()`;
   `octokit.rest.repos.listCommits({ owner, repo, sha: branch, per_page: 100 })`.
   1. If `task.pr_number` is set, best-effort `octokit.rest.pulls.get(...)`:
      `prState = data.merged ? "merged" : data.state`. A thrown PR fetch is
      swallowed (stays `null`).
   2. A thrown `listCommits` with `status === 404` → `200` with
      `commits: [], pr_state: null, branch_deleted: true`.
   3. Any other thrown error logs `"[timeline] listCommits failed:"` →
      `500 { error: "github_api" }`.
7. **Fold** — `buildTimeline(commitsApi, task.created_at)`
   ([pure fn](../../../apps/lore-api/src/api/routes/tasks/task-timeline.ts#L29)):
   reverse the newest-first GitHub list to chronological; for each commit parse
   `parseTrailers(message)` and skip commits with none; emit a `TimelineCommit`
   with `outcome = extras["Lore-Outcome"] ?? "success"`,
   `committed_at = committer.date ?? now`, `duration_ms = committedMs - prevTimeMs`
   (or `null` when non-finite), `summary = first line`, and `extras` only when
   present. `prevTimeMs` starts at `created_at` and advances per stage.
8. `current_stage` = the last stage commit's `stage`, or `null` when empty.
9. **Lease** — best-effort `SELECT holder, expires_at FROM pipeline.task_leases
   WHERE branch_name = $1` with `[branch]`. A row → `lease = { held: expires_at >
   now, holder, expires_at: ISO }`; no row → `{ held: false }`; a thrown query
   (table missing) leaves `lease = null`.
10. Return `200` with the full timeline object.

## Output

Verbatim error strings: `"database unavailable"`, `"not found"`, `"internal"`,
`"task_not_found"`, `"github_api"`. Degenerate 200 markers: `pending:
"no_branch"`, `branch_deleted: true`. All non-throwing terminal states.

## Dependencies & side effects

- Handler `handleTaskTimeline`; pure helper `buildTimeline`; `parseTrailers`
  (`@re-cinq/lore-shared`); `getOctokit` (`platform/github-client.ts`); `json`.
- DB reads: `pipeline.tasks`, `pipeline.task_leases`. No writes.
- GitHub API: `repos.listCommits`, `pulls.get` (read-only).
- Logs on the two server-error paths. No env vars beyond GitHub auth.

## Acceptance Criteria

A null pool returns 503. ([validated by `timeline.test.ts:78`](apps/lore-api/src/api/routes/tasks/timeline.test.ts#L78))

A path the dispatcher admits but the handler regex rejects returns 404 `not found`.

A throwing task lookup returns 500. ([validated by `timeline.test.ts:84`](apps/lore-api/src/api/routes/tasks/timeline.test.ts#L84))

An unknown task returns `task_not_found`. ([validated by `timeline.test.ts:93`](apps/lore-api/src/api/routes/tasks/timeline.test.ts#L93))

A task with no branch returns `pending: no_branch` with empty commits. ([validated by `timeline.test.ts:99`](apps/lore-api/src/api/routes/tasks/timeline.test.ts#L99))

A full run yields ordered stage commits, merged PR state, current stage, and a held lease. ([validated by `timeline.test.ts:108`](apps/lore-api/src/api/routes/tasks/timeline.test.ts#L108))

A failing PR fetch and empty lease degrade to null PR state and an unheld lease. ([validated by `timeline.test.ts:163`](apps/lore-api/src/api/routes/tasks/timeline.test.ts#L163))

A task with no `pr_number` skips the PR fetch. ([validated by `timeline.test.ts:184`](apps/lore-api/src/api/routes/tasks/timeline.test.ts#L184))

Commit field fallbacks (null date, missing extras, non-finite duration) are handled. ([validated by `timeline.test.ts:196`](apps/lore-api/src/api/routes/tasks/timeline.test.ts#L196))

A GitHub 404 on the branch returns `branch_deleted: true`. ([validated by `timeline.test.ts:232`](apps/lore-api/src/api/routes/tasks/timeline.test.ts#L232))

A non-404 GitHub error returns 500 `github_api`. ([validated by `timeline.test.ts:245`](apps/lore-api/src/api/routes/tasks/timeline.test.ts#L245))

A failing lease query leaves the lease null. ([validated by `timeline.test.ts:258`](apps/lore-api/src/api/routes/tasks/timeline.test.ts#L258))

`buildTimeline` returns empty when no commit carries trailers. ([validated by `timeline-build.test.ts:15`](apps/lore-api/src/api/routes/tasks/timeline-build.test.ts#L15))

`buildTimeline` reverses newest-first order into chronological stages. ([validated by `timeline-build.test.ts:23`](apps/lore-api/src/api/routes/tasks/timeline-build.test.ts#L23))

`buildTimeline` computes per-stage duration from the previous commit time. ([validated by `timeline-build.test.ts:40`](apps/lore-api/src/api/routes/tasks/timeline-build.test.ts#L40))

`buildTimeline` defaults outcome to success and surfaces `Lore-Outcome`. ([validated by `timeline-build.test.ts:57`](apps/lore-api/src/api/routes/tasks/timeline-build.test.ts#L57))

`buildTimeline` filters non-trailer commits while keeping trailered ones. ([validated by `timeline-build.test.ts:74`](apps/lore-api/src/api/routes/tasks/timeline-build.test.ts#L74))

## Out of Scope

- Trailer format / `parseTrailers` grammar — owned by `shared/src/commit-trailers.ts`.
- The web UI `Timeline.tsx` rendering / polling.
- GitHub App authentication — owned by `platform/github-client.ts`.
