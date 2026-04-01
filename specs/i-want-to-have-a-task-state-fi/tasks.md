# Task State Filter Implementation

## Phase 1: Setup

- [ ] T001 [P] Create filter component structure in `web-ui/src/components/TaskStateFilter.tsx`
- [ ] T002 [P] Define task state types and constants in `web-ui/src/lib/taskStates.ts`
- [ ] T003 [P] Set up state management hook in `web-ui/src/hooks/useTaskStateFilter.ts`

## Phase 2: Core

- [ ] T004 Build TaskStateFilter UI component with dropdown/checkbox selector in `web-ui/src/components/TaskStateFilter.tsx`
- [ ] T005 Implement filter logic to parse query parameters in `web-ui/src/lib/filterUtils.ts`
- [ ] T006 Add filter parameter handling to pipeline query in `web-ui/src/lib/api/pipeline.ts`
- [ ] T007 Update PostgreSQL queries in `agent/src/db/pipeline.ts` to support state filtering
- [ ] T008 Add MCP tool parameter validation in `mcp-server/src/tools/pipeline.ts` for state filter
- [ ] T009 Integrate filter state with existing task list component in `web-ui/src/components/PipelineTaskList.tsx`

## Phase 3: Integration

- [ ] T010 Add URL state persistence for filter in `web-ui/src/components/PipelineView.tsx`
- [ ] T011 Write filter tests in `web-ui/__tests__/components/TaskStateFilter.test.tsx`
- [ ] T012 Update README.md with task state filter usage documentation
- [ ] T013 Add filter UI to analytics dashboard in `web-ui/src/pages/analytics.tsx`
- [ ] T014 Test end-to-end: filter persistence across page navigation and session reload
- [ ] T015 Deploy to staging and verify filter works with real pipeline data in `n8n-cluster`