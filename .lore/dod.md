# Definition of Done

> Make backlog ranking configurable per repo and expose the next pick as an MCP tool

**Strategy: `direct`** — The `selectNextIssue` logic is already a pure function seam that can accept configuration, and the MCP tools registry is the natural seam to test for the existence of the new `lore_next_ready_issue` tool.

## Done when these pass

- [ ] **Backlog ranking configuration** — verifies a repo's settings reordering the criteria changes the next pick, tests the unblocks criterion, and tests the size criterion
  `libs/shared/src/work/backlog/select-next-issue.acceptance.test.ts`
- [ ] **lore_next_ready_issue tool** — verifies the tool returns the next pick with a because reason, handles empty backlogs gracefully, and behaves consistently over multiple calls
  `apps/mcp-server/src/transport/tools/lore-next-ready-issue.acceptance.test.ts`

## Facets

- [x] Update `selectNextIssue` and `orderBacklog` to accept ranking configuration options
- [x] Implement ranking rule for `unblocks` (using `blockedByCount`)
- [x] Implement ranking rule for `size` (smaller first)
- [x] Read repo settings in the implementation loop tick to pass custom criteria
- [x] Implement the `lore_next_ready_issue` tool handler returning the next pick and reason
- [x] Register the new tool in `apps/mcp-server/src/transport/tools/repo-tools.ts`

## Out of scope

- Dispatching the selected issue (the loop does that)
- Re-ranking a running task
- Effort estimation beyond the existing `size:` label
