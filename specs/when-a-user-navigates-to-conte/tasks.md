# Task Breakdown: File Navigation and Expansion in Context View

## Phase 1: Setup

- [ ] T001 [P] Set up feature branch and establish component structure in `web-ui/src/components/FileExplorer/` with TypeScript interfaces for file tree navigation
- [ ] T002 [P] Create Zod schemas for GitHub file metadata validation in `mcp-server/src/schemas/github-files.ts`
- [ ] T003 [P] Add GitHub API integration types in `agent/src/github.ts` for fetching raw file URLs and repository metadata

## Phase 2: Core Implementation

- [ ] T004 Create clickable file title component that generates GitHub raw content URL in `web-ui/src/components/FileExplorer/FileTitle.tsx` using GitHub URL pattern `https://github.com/{owner}/{repo}/blob/{branch}/{path}`
- [ ] T005 Implement file expansion toggle UI in `web-ui/src/components/FileExplorer/FileExpander.tsx` with expand/collapse icon and state management
- [ ] T006 Add MCP tool `get_file_github_url` in `mcp-server/src/tools/github-integration.ts` to resolve file paths to clickable GitHub links
- [ ] T007 Build file content fetching logic in `web-ui/src/hooks/useFileContent.ts` to retrieve expanded file preview (limit to first 500 lines to avoid performance issues)
- [ ] T008 Create file preview modal/panel in `web-ui/src/components/FileExplorer/FilePreview.tsx` displaying truncated content with "View Full on GitHub" button
- [ ] T009 Implement keyboard navigation in `web-ui/src/components/FileExplorer/FileExplorer.tsx` for expanded/collapsed states (arrow keys, enter to open)
- [ ] T010 [P] Add GitHub link click handler that opens `github.com` in new tab via `target="_blank" rel="noopener noreferrer"`
- [ ] T011 [P] Style file title links with GitHub-style hover effects in `web-ui/src/styles/FileExplorer.module.css` (underline, color change)

## Phase 3: Integration & Polish

- [ ] T012 Update Context component in `web-ui/src/components/Context/` to integrate new FileExplorer with expansion capability
- [ ] T013 Add TypeScript types in `web-ui/src/types/file.ts` for expanded file state, GitHub URLs, and preview metadata
- [ ] T014 Wire MCP tool calls to frontend via `web-ui/src/services/mcp-client.ts` for `get_file_github_url`
- [ ] T015 Test file title clickability with sample repos in `web-ui/__tests__/FileExplorer.test.tsx` (verify URLs, new tab behavior)
- [ ] T016 Test file expansion with mock large files (>1000 lines) in `web-ui/__tests__/FilePreview.test.tsx` to verify truncation and performance
- [ ] T017 Update `web-ui/src/hooks/useContext.ts` to track expanded/collapsed state per file across re-renders
- [ ] T018 Add analytics tracking in `web-ui/src/services/analytics.ts` for "file_opened_in_github" and "file_expanded" events
- [ ] T019 Document UI patterns in `specs/file-navigation/ui-patterns.md` (keyboard shortcuts, link behavior, expansion limits)
- [ ] T020 Perform accessibility audit in `web-ui/__tests__/FileExplorer.a11y.test.tsx` (tab order, ARIA labels for expand/collapse button, keyboard focus)
- [ ] T021 Create end-to-end test in `web-ui/e2e/file-navigation.spec.ts` covering: title click → GitHub tab opens, expand icon click → content displays, large file truncation