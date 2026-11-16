# Definition of Done

> The tool is registered and reads the same ordered backlog surface, returning a next issue/reason with existing tests. It does not check the disabled/onboarding/busy gates that the linked driver criteria apply before a pick, so 'equals the loop's own next pick' is not proven across those states.

**Strategy: `direct`** — The `lore_next_ready_issue` tool provides a clear testable surface where we can assert the tool's behavior directly against its underlying dependencies without needing test doubles.

## Done when these pass

- [ ] **returns no issue and a reason when the loop is disabled** — The tool returns no issue when the loop is disabled.
  `apps/mcp-server/src/transport/tools/repo/next-ready-issue.acceptance.test.ts`
- [ ] **returns no issue and a reason when onboarding is unmerged** — The tool returns no issue when onboarding is unmerged.
  `apps/mcp-server/src/transport/tools/repo/next-ready-issue.acceptance.test.ts`
- [ ] **returns no issue and a reason when the repo is already busy** — The tool returns no issue when a run is already active.
  `apps/mcp-server/src/transport/tools/repo/next-ready-issue.acceptance.test.ts`

## Facets

- [ ] Update `lore_next_ready_issue` tool to check `loopState.enabled` and return no issue when false.
- [ ] Update `lore_next_ready_issue` tool to check `loopState.onboarding.merged` and return no issue when false.
- [ ] Update `lore_next_ready_issue` tool to check `loopState.current` and return no issue when a run is active.

## Out of scope

- Changes to the underlying Lore API `/api/repos/{owner}/{repo}/implementation-loop` are out of scope.
