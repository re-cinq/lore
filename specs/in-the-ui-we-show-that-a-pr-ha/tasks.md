# Task Breakdown: Show PR State in UI

## Phase 1: Platform + API

- [x] T001 [P] Add `getPRDetails` method to `CodePlatform` interface in `agent/src/platform.ts` — returns `PRDetails` with computed status
- [x] T002 [P] Implement `getPRDetails` in `agent/src/github.ts` — call `pulls.get`, `checks.listForRef`, `pulls.listReviews` in parallel, compute `PRStatus` enum
- [x] T003 Add Next.js API route `web-ui/src/app/api/pipeline/[id]/pr-status/route.ts` — reads task's `pr_number` + `target_repo` from DB, calls `getPRDetails`, returns JSON

## Phase 2: UI Components

- [x] T004 [DEPENDS ON: T003] Create `web-ui/src/app/pipeline/[id]/PRStatusCard.tsx` client component — fetches `/api/pipeline/{id}/pr-status` on mount, renders status badge, check results, review status, PR link
- [x] T005 [DEPENDS ON: T003] Add PR status indicator to pipeline list view in `web-ui/src/app/pipeline/page.tsx` — small color-coded badge next to PR link for tasks with `pr_url`
- [x] T006 [DEPENDS ON: T004] Handle error/unavailable state — show "Status unavailable" with existing PR link as fallback when GitHub API is unreachable

## Phase 3: MCP Tool + Tests

- [x] T007 [DEPENDS ON: T002] Add `lore_get_pr_status` MCP tool in `mcp-server/src/index.ts` — accepts `repo` + `pr_number`, calls GitHub API, returns `PRDetails` structure
- [x] T008 [DEPENDS ON: T002] Unit tests for `getPRDetails` and `PRStatus` computation in `agent/src/__tests__/github.test.ts`
- [x] T009 [DEPENDS ON: T004] Unit tests for `PRStatusCard` component rendering each state in `web-ui/src/app/pipeline/[id]/__tests__/PRStatusCard.test.tsx`
