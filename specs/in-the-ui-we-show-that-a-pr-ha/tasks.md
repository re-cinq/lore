# Task Breakdown: Show PR State in UI

## Phase 1: Setup & Analysis

- [ ] T001 [P] Analyze current PR display implementation in `web-ui/src/components/PullRequestCard.tsx`
- [ ] T002 [P] Audit GitHub API schema for PR state fields (draft, mergeable, review_decision, checks) in `agent/src/github.ts`
- [ ] T003 [P] Review existing state badge patterns in `web-ui/src/components/` (StatusBadge, ReviewBadge patterns)
- [ ] T004 Document PR state machine: draft → open → review → approved/changes-requested → merged/closed in `specs/show-pr-state-in-ui/state-machine.md`

## Phase 2: Core Implementation

- [ ] T005 [P] Create PR state type definition in `web-ui/src/types/pr-state.ts` with states: draft, open, pending-review, approved, changes-requested, merged, closed
- [ ] T006 [P] Update GitHub API fetch to retrieve full PR state in `agent/src/github.ts` - getPullRequest() must return status, mergeable, review_decision, check_runs
- [ ] T007 Extend `web-ui/src/components/PullRequestCard.tsx` to display state badge with color coding (blue=draft, yellow=review, green=approved, red=changes-requested, purple=merged)
- [ ] T008 Add linked issue state display in `web-ui/src/components/LinkedIssueCard.tsx` showing open/closed/completed status
- [ ] T009 Create PR state indicator component `web-ui/src/components/PRStateIndicator.tsx` with review decision, check status, and merge status
- [ ] T010 [P] Update GraphQL query in `web-ui/src/graphql/queries/getPullRequestDetails.ts` to fetch all state-related fields from API
- [ ] T011 [P] Update API endpoint in `agent/src/api/handlers/pr-details.ts` to return complete PR state object

## Phase 3: Integration & Polish

- [ ] T012 Add state filtering to PR list view in `web-ui/src/pages/pipeline/index.tsx` (filter by draft, in-review, approved, merged)
- [ ] T013 Implement state change detection in `web-ui/src/hooks/usePRPolling.ts` to trigger updates when PR state changes
- [ ] T014 [P] Add PR state to pipeline task detail page `web-ui/src/components/TaskDetail/PRSection.tsx` with last-updated timestamp
- [ ] T015 Update `mcp-server/src/tools/pipeline.ts` - get_pipeline_status should include current PR state for each task
- [ ] T016 Add linked issue state sync in `agent/src/tasks/task-processor.ts` - update GitHub Issue status based on PR state changes
- [ ] T017 Create unit tests for state transitions in `web-ui/src/components/__tests__/PRStateIndicator.test.tsx`
- [ ] T018 Create integration test for PR state polling in `web-ui/src/__tests__/integration/pr-state-polling.test.ts`
- [ ] T019 Update PR state display in mobile view `web-ui/src/components/PullRequestCard.mobile.tsx` to show compact state indicator
- [ ] T020 Add state change tooltip/hover info in `web-ui/src/components/PRStateIndicator.tsx` showing when state last changed and by whom
- [ ] T021 Document PR state display feature in `README.md` under "Monitoring" section with screenshot
- [ ] T022 Update `CLAUDE.md` with agent instructions for interpreting PR state via MCP tools