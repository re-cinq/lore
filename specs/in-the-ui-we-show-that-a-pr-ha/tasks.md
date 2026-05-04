# Task Breakdown: Show PR State in UI

## Phase 1: Platform + API

- [x] T001 [P] Add `getPRDetails` method to `CodePlatform` interface in `agent/src/platform.ts` — returns `PRDetails` with computed status
- [x] T002 [P] Implement `getPRDetails` in `agent/src/github.ts` — call `pulls.get`, `checks.listForRef`, `pulls.listReviews` in parallel, compute `PRStatus` enum
- [x] T003 Add Next.js API route `web-ui/src/app/api/pipeline/[id]/pr-status/route.ts` — reads task's `pr_number` + `target_repo` from DB, calls `getPRDetails` from `web-ui/src/lib/github.ts` (see note below), returns JSON

## Phase 2: UI Components

- [x] T004 [DEPENDS ON: T003] Create `web-ui/src/app/pipeline/[id]/PRStatusCard.tsx` client component — fetches `/api/pipeline/{id}/pr-status` on mount, renders status badge, check results, review status, PR link
- [x] T005 [DEPENDS ON: T003] Add PR status indicator to pipeline list view in `web-ui/src/app/pipeline/page.tsx` — implemented as a separate `web-ui/src/app/pipeline/PRStatusBadge.tsx` component (not inline in page.tsx); renders a small color-coded pill; silently no-ops on fetch error
- [x] T006 [DEPENDS ON: T004] Handle error/unavailable state — show "Status unavailable" with existing PR link as fallback when GitHub API is unreachable

## Phase 3: MCP Tool + Tests

- [x] T007 [DEPENDS ON: T002] Add `get_pr_status` MCP tool in `mcp-server/src/index.ts` — accepts `repo` + `pr_number`, calls GitHub API directly via `getGitHubToken()` + raw `fetch()` (does not reuse `agent/src/github.ts`), returns `PRDetails` structure
- [ ] T008 [DEPENDS ON: T002] Unit tests for `getPRDetails` and `PRStatus` computation in `agent/src/__tests__/github.test.ts` — **not implemented**
- [ ] T009 [DEPENDS ON: T004] Unit tests for `PRStatusCard` component rendering each state in `web-ui/src/app/pipeline/[id]/__tests__/PRStatusCard.test.tsx` — **not implemented**

---

## Implementation Notes (drift from original spec)

### web-ui GitHub client (`web-ui/src/lib/github.ts`)

The spec planned to have the Next.js API route call `getPRDetails` from
`agent/src/github.ts` via the `CodePlatform` interface. In practice a
separate GitHub client was created at `web-ui/src/lib/github.ts` that:

- Uses GitHub App auth (`createAppAuth`) with the same env vars as the
  MCP server (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
  `GITHUB_APP_INSTALLATION_ID`)
- Exports `getPRDetails`, `computeStatus`, `isGitHubConfigured`, and the
  `PRDetails`/`PRStatus` types
- Is the only file that should be imported by web-ui server routes for
  GitHub calls

As a result `computeStatus` logic is duplicated in three places:

| File | Notes |
|------|-------|
| `agent/src/github.ts` | Used by agent jobs and MCP agent-side tools |
| `web-ui/src/lib/github.ts` | Used by the Next.js API route |
| `mcp-server/src/index.ts` | Inlined inside the `get_pr_status` tool handler |

The approved-state guard differs subtly: the agent version passes when
`c.status !== 'completed'` (pending checks don't block `approved`); the
web-ui version requires all checks to have a non-null passing conclusion.
The mcp-server inline matches the web-ui version. Consolidation is
tracked but not yet done.

### `PRStatusBadge.tsx` (list view)

`web-ui/src/app/pipeline/PRStatusBadge.tsx` is a thin client component
used in the pipeline list page. It fetches the same `/api/pipeline/{id}/pr-status`
route on mount and renders only the `computed_status` pill. Errors are
silently swallowed (returns `null`) so the list row degrades gracefully.

### No polling in `PRStatusCard`

`PRStatusCard` fetches once on mount. The adjacent `Timeline` component
on the same page polls every 10 s, but PR status does not follow suit.
If CI finishes or a review is submitted while the page is open, the badge
won't update until the user refreshes.

### Feedback form (untracked)

`web-ui/src/app/pipeline/[id]/page.tsx` includes a "Give Feedback"
server-action form that creates an `immediate`-priority revision task on
the same branch. This was added after the spec shipped and is not
reflected in any spec or task entry.
