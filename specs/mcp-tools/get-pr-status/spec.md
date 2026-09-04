# Feature Specification: lore_get_pr_status MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_get_pr_status MCP Tool         |
| Status  | In Progress                    |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_get_pr_status`                |
| Module  | pipeline (`pipeline-tools.ts`) |
| Scope   | shared                         |

`lore_get_pr_status` fetches a task's live PR state from GitHub and folds PR state, check-run conclusions, and review verdicts into one derived `computed_status`, returning the underlying checks and reviews without the caller scripting the GitHub REST API.

## Problem Statement

A task's PR is the canonical artifact, but its true state lives on GitHub:
draft, open, checks-failing, changes-requested, approved, merged, or closed. The
caller needs a single derived status — folding PR state, check-run conclusions,
and review verdicts into one word — plus the underlying checks and reviews,
without scripting the GitHub REST API.

## Interface

Registered via `server.tool` ([registration + handler](apps/mcp-server/src/mcp/tools/pipeline-tools-lifecycle.ts#L182)).

- **name**: `lore_get_pr_status`
- **description** (verbatim):

```text
Fetches live PR state from GitHub and returns a derived computed_status (merged | closed | draft | checks-failing | changes-requested | approved | open) plus CI checks and reviews. Use this for the real-time PR/CI/review verdict. Instead: lore_get_pipeline_status for the Lore task's stored status and event timeline.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `repo` | string | yes | — | `owner/repo` format. |
| `pr_number` | number | yes | — | PR number (integer from the PR URL, not a UUID). |

## Behavior

1. Dynamically import and call `fetchPrStatus(repo, pr_number)`
   ([github fetch + status derivation](../../../apps/lore-api/src/platform/github-client.ts#L186)).
2. **Credential gate** — `fetchPrStatus` resolves `getGitHubToken()`; if null it
   returns `null` and the handler returns
   `"GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN."`
3. **REST fetches** (all `https://api.github.com` with `Authorization: Bearer {token}`,
   `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`):
   - `GET /repos/{repo}/pulls/{pr_number}` and `GET /repos/{repo}/pulls/{pr_number}/reviews`
     in parallel (`Promise.all`; reviews fall back to `[]` on error).
   - `GET /repos/{repo}/commits/{pr.head.sha}/check-runs` (errors → no checks).
   A non-ok PR/review fetch throws `GitHub API {path}: {status} {statusText}`.
4. **Normalize** — `checks = [{name, status, conclusion}]`;
   `reviews = [{user, state, submitted_at}]`.
5. **Derive `computed_status`** by fixed precedence:
   1. `merged` → `pr.merged` truthy
   2. `closed` → `pr.state === "closed"`
   3. `draft` → `pr.draft`
   4. `checks-failing` → any check conclusion `failure` or `timed_out`
   5. `changes-requested` → any review state `CHANGES_REQUESTED`
   6. `approved` → any review `APPROVED` AND every check conclusion in `{success, skipped, null}`
   7. `open` → otherwise
6. Return `{number, title, state, draft, merged, mergeable, html_url, checks, reviews, computed_status}`
   as `JSON.stringify(result, null, 2)`.
7. Any thrown error is caught and returned as `"Error: {message}"`.

## Output

A single MCP text content block — one of: the pretty-printed PR status JSON, the
`"GitHub not configured…"` message, or `"Error: {message}"`. **Never throws.**

## Dependencies & side effects

- `fetchPrStatus` → `getGitHubToken()` (GitHub App or token). Read-only against GitHub.
- GitHub REST: pulls, pulls/reviews, commits/{sha}/check-runs.
- Env: `GITHUB_APP_ID` / `GITHUB_PRIVATE_KEY` / `GITHUB_INSTALLATION_ID` or `GITHUB_TOKEN`.
- No DB access; no transport branch (always direct GitHub).

## Acceptance Criteria

A merged/closed/draft/checks-failing/changes-requested/approved/open PR maps to
the matching `computed_status` by the fixed precedence above.
*(untested: `fetchPrStatus` issues three live `fetch` calls to api.github.com with no injectable seam; the status derivation is not extracted as a pure function.)*

Missing GitHub credentials return a configuration message instead of throwing.
*(untested: the null path is gated on `getGitHubToken()` reading process env / GitHub App state — no deterministic seam without live config.)*

The `/api/pr-status` HTTP route (the same `fetchPrStatus` behind the tool) validates its query: a valid `repo` + integer `pr_number` returns the derived status, an unconfigured GitHub (`fetchPrStatus` → null) returns 424, a `repo` that is not `owner/name` or a missing or non-integer `pr_number` returns 400, and a thrown fetch returns 500. ([validated by GET /api/pr-status returns the PR status for a valid repo and pr_number](apps/lore-api/src/api/routes/repos/pr-status.test.ts#L29), [`pr-status.test.ts:37`](apps/lore-api/src/api/routes/repos/pr-status.test.ts#L37), [`pr-status.test.ts:44`](apps/lore-api/src/api/routes/repos/pr-status.test.ts#L44), [`pr-status.test.ts:50`](apps/lore-api/src/api/routes/repos/pr-status.test.ts#L50), [`pr-status.test.ts:56`](apps/lore-api/src/api/routes/repos/pr-status.test.ts#L56), [`pr-status.test.ts:62`](apps/lore-api/src/api/routes/repos/pr-status.test.ts#L62))

## Out of Scope

- Persisting PR state to the task row (the watcher / merge-check jobs own that).
- Posting reviews or comments (`postReviewComment` and other platform calls).
