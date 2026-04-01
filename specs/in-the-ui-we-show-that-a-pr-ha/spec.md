# Feature Specification: PR State Visibility

| Field             | Value                                      |
|-------------------|--------------------------------------------|
| Feature           | PR State Visibility                        |
| Branch            | feat/pr-state-visibility                   |
| Status            | Shipped                                    |
| Created           | 2026-03-26                                 |
| Updated           | 2026-04-01                                 |
| Owner             | Platform Engineering                       |
| Target            | 2-3 working days                           |

## Problem Statement

When developers create a PR through Lore (via pipeline tasks, `/lore-pr`,
or agent delegation), the UI only shows a "PR" link. To understand
whether the PR is draft, failing CI, awaiting review, or merged, they
must context-switch to GitHub. This friction slows PR review cycles.

## Approach: Live Fetch, No DB Changes

The `pipeline.tasks` table already has `pr_url` and `pr_number`. We
don't need new tables or columns. Instead:

1. **Add a `getPRDetails` method** to the `CodePlatform` interface that
   calls `GET /repos/{owner}/{repo}/pulls/{number}` and returns
   structured PR state (draft, checks, reviews, mergeable).
2. **Add a Next.js API route** (`/api/pipeline/[id]/pr-status`) that
   reads the task's `pr_number` + `target_repo`, calls `getPRDetails`,
   and returns computed PR state.
3. **Add a client component** that fetches this route on mount and
   renders a PR status card (state badge, check results, review status).
4. **Add an MCP tool** (`get_pr_status`) so agents can query PR state
   programmatically.

No polling jobs, no cached state, no schema migrations. The UI fetches
live from GitHub on page load. If GitHub is down, show "Status
unavailable" with the existing PR link as fallback.

## PR State Enum

Computed from the GitHub API response, not stored:

```typescript
type PRStatus =
  | 'draft'
  | 'open'
  | 'checks-failing'
  | 'changes-requested'
  | 'approved'
  | 'merged'
  | 'closed';
```

**State determination:**
```
if pr.merged       → 'merged'
if pr.state=closed → 'closed'
if pr.draft        → 'draft'
if any check failing → 'checks-failing'
if any review = changes_requested → 'changes-requested'
if any review = approved and checks pass → 'approved'
else → 'open'
```

## What Changes

### 1. `agent/src/platform.ts` — New interface method

```typescript
interface PRDetails {
  number: number;
  title: string;
  state: string;          // open, closed
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  html_url: string;
  checks: Array<{ name: string; status: string; conclusion: string | null }>;
  reviews: Array<{ user: string; state: string; submitted_at: string }>;
  computed_status: PRStatus;
}

// Add to CodePlatform interface:
getPRDetails(repo: string, prNumber: number): Promise<PRDetails>;
```

### 2. `agent/src/github.ts` — Implementation

Call `pulls.get`, `checks.listForRef`, and `pulls.listReviews` in
parallel. Compute `computed_status` from the results.

### 3. `web-ui/src/app/api/pipeline/[id]/pr-status/route.ts` — API route

Server-side route that:
- Reads task from DB (get `target_repo`, `pr_number`)
- Calls GitHub API via the platform abstraction
- Returns JSON with PR details

### 4. `web-ui/src/app/pipeline/[id]/PRStatusCard.tsx` — Client component

Fetches `/api/pipeline/{id}/pr-status` on mount. Renders:
- Status badge (color-coded)
- Check results (pass/fail count)
- Review status (approved by, changes requested by)
- PR link

### 5. `mcp-server/src/index.ts` — New MCP tool

`get_pr_status(repo, pr_number)` — calls GitHub API, returns same
`PRDetails` structure. Agents use this to check PR state.

### 6. Pipeline list view enhancement

On `web-ui/src/app/pipeline/page.tsx`, for tasks with `pr_url`,
show a small status indicator next to the PR link (fetched client-side).

## Out of Scope

1. **DB caching / polling** — Phase 1. Live fetch is sufficient now.
2. **GitHub Issue state sync** — Already works via task events.
3. **Webhook integration** — Not needed for live fetch.
4. **Auto-merge** — Separate feature.
5. **PR comment parsing** — Separate feature.
6. **State history / analytics** — Requires DB; deferred.

## Acceptance Criteria

1. Task detail page shows live PR status badge when a PR exists
2. Check results (pass/fail) visible without going to GitHub
3. Review status (who approved, who requested changes) visible
4. MCP tool `get_pr_status` returns structured PR state
5. Graceful fallback when GitHub API is unavailable
6. No database migrations required
