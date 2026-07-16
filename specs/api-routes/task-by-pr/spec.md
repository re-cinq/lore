# Feature Specification: GET /api/tasks/by-pr/:owner/:repo/:n

| Field      | Value                                                            |
|------------|------------------------------------------------------------------|
| Feature    | PR → task resolver                                               |
| Status     | Draft                                                            |
| Created    | 2026-06-10                                                      |
| Owner      | Platform Engineering                                            |
| Route      | `GET /api/tasks/by-pr/:owner/:repo/:n`                         |
| Auth scope | `read` (prefix `/api/tasks` → `read`)                          |
| Module     | Task timeline (`api/routes/task-timeline.ts` → `handleTaskByPr`) |

GET /api/tasks/by-pr/:owner/:repo/:n resolves the Lore task that produced a given pull request for webhook handlers and the UI, using the DB `pr_number` fast path and falling back to parsing the `Lore-Task` trailer from the PR body or head commit.

## Problem Statement

Every Lore-authored PR carries a `Lore-Task: <uuid>` trailer in its body and on
its final commit. Webhook handlers, the UI, and operators need to go the other
way: given a PR (`owner/repo/#n`), find the originating task. The DB is the fast
path (`pipeline.tasks.pr_number`), but tasks created off-DB or before the
`pr_number` write still need resolving — so the handler falls back to the GitHub
API and parses the trailer out of the PR body, then the head commit.

## Interface

Registered as `pattern(/^\/api\/tasks\/by-pr\/[^/]+\/[^/]+\/[0-9]+(\?|$)/, "GET")`
→ `handleTaskByPr(req, res, pool)`
([registration](../../../apps/mcp-server/src/api/routes/index.ts#L58),
[handler](../../../apps/mcp-server/src/api/routes/task-timeline.ts#L213)). Placed
**before** the broad `/api/tasks` GET list route. `:n` is constrained to digits.

- **Method + path**: `GET /api/tasks/by-pr/:owner/:repo/:n`. `owner` / `repo` are
  `[^/]+` (URL-decoded); `n` is parsed with `parseInt(…, 10)`.
- **Auth scope**: `read` (same `/api/tasks` prefix as the list/timeline routes,
  [scope map](../../../apps/mcp-server/src/api/routes/auth.ts#L40)). Rate-limit bucket
  `task` (60/min).
- **Request**: path params only.

### Response shape

| Status | Body                                                                 |
|--------|----------------------------------------------------------------------|
| 200    | `{ task_id, trailer_source: "db" \| "pr_body" \| "final_commit" }`   |
| 404    | `{ error: "no_trailer_found" }` or `{ error: "pr_not_found" }`      |
| 500    | `{ error: "github_api" }`                                            |
| 503    | `{ error: "database unavailable" }`                                 |

## Behavior

1. **Pool gate** — null pool → `503 { error: "database unavailable" }`.
2. Match `BY_PR_RE` (`/^\/api\/tasks\/by-pr\/([^/]+)\/([^/]+)\/([0-9]+)/`); the
   dispatcher only routes here on a full match so `m` is non-null.
   `owner = decode(m[1])`, `repoName = decode(m[2])`, `prNumber = parseInt(m[3])`,
   `repo = "${owner}/${repoName}"`.
3. **DB fast path** — `SELECT id FROM pipeline.tasks WHERE target_repo = $1 AND
   pr_number = $2 LIMIT 1` with `[repo, prNumber]`. On a row →
   `200 { task_id: rows[0].id, trailer_source: "db" }`. A thrown query logs
   `"[by-pr] DB lookup failed:"` and **falls through** to the GitHub path (no early
   return) — DB unavailability never blocks resolution.
4. **GitHub fallback** (entered on DB miss or DB error):
   1. `getOctokit()`; `pulls.get({ owner, repo, pull_number })`.
   2. **PR body** — match `pr.data.body` against
      `LORE_TASK_TRAILER_RE = /^Lore-Task:\s*([0-9a-f-]+)\s*$/im`. On a hit →
      `200 { task_id: m[1], trailer_source: "pr_body" }`.
   3. **Final commit** — `git.getCommit({ owner, repo, commit_sha: pr.data.head.sha })`;
      `parseTrailers(message)`; if `trailers?.taskId` →
      `200 { task_id, trailer_source: "final_commit" }`.
   4. Neither yields a trailer → `404 { error: "no_trailer_found" }`.
5. **GitHub error handling** — a thrown call with `status === 404` →
   `404 { error: "pr_not_found" }`; any other error logs
   `"[by-pr] GitHub fallback failed:"` → `500 { error: "github_api" }`.

The two trailer sources differ deliberately: the PR-body regex matches the raw
markdown line, while the final-commit path delegates to the shared `parseTrailers`
grammar (which reads the structured `Lore-Task:` trailer).

## Output

`trailer_source` enumerates provenance: `db` (Postgres hit), `pr_body` (regex on
PR body), `final_commit` (`parseTrailers` on the head commit). Verbatim error
strings: `"database unavailable"`, `"no_trailer_found"`, `"pr_not_found"`,
`"github_api"`.

## Dependencies & side effects

- Handler `handleTaskByPr`; `parseTrailers` (`@re-cinq/lore-shared`); `getOctokit`
  (`platform/github-client.ts`); `json`.
- DB read: `pipeline.tasks` (no write).
- GitHub API: `pulls.get`, `git.getCommit` (read-only).
- Logs on DB-error and GitHub-error paths. No env vars beyond GitHub auth.

## Acceptance Criteria

A null pool returns 503. ([validated by `by-pr.test.ts:46`](apps/lore-api/src/api/routes/tasks/by-pr.test.ts#L46))

A non-numeric `:n` PR segment is rejected with 400 `{ error: "invalid pr number" }` without touching the DB. ([validated by `by-pr.test.ts:52`](apps/lore-api/src/api/routes/tasks/by-pr.test.ts#L52))

A `pr_number` hit in the DB returns `trailer_source: db`. ([validated by `resolves via the DB fast path`](apps/lore-api/src/api/routes/tasks/by-pr.test.ts#L65))

A DB miss with a trailer in the PR body returns `trailer_source: pr_body`. ([validated by `by-pr.test.ts:74`](apps/lore-api/src/api/routes/tasks/by-pr.test.ts#L74))

A DB error falls through, and a trailer on the final commit returns `trailer_source: final_commit`. ([validated by `by-pr.test.ts:92`](apps/lore-api/src/api/routes/tasks/by-pr.test.ts#L92))

Neither body nor commit carrying a trailer returns `no_trailer_found`. ([validated by `returns 404 when no trailer is found anywhere`](apps/lore-api/src/api/routes/tasks/by-pr.test.ts#L114))

A GitHub 404 on the PR returns `pr_not_found`. ([validated by `by-pr.test.ts:133`](apps/lore-api/src/api/routes/tasks/by-pr.test.ts#L133))

A non-404 GitHub error returns 500 `github_api`. ([validated by `by-pr.test.ts:148`](apps/lore-api/src/api/routes/tasks/by-pr.test.ts#L148))

A DB-error fallback that resolves from the PR body uses the GitHub path without surfacing the DB error. ([validated by `by-pr.test.ts:163`](apps/lore-api/src/api/routes/tasks/by-pr.test.ts#L163))

## Out of Scope

- `parseTrailers` grammar — owned by `shared/src/commit-trailers.ts`.
- GitHub App authentication — owned by `platform/github-client.ts`.
- Writing `pr_number` onto the task (done by the loretask-watcher).
