# Definition of Done

> The current run page loads nodes, task events, model calls, issue and definition data but never queries the per-PR blocked-reason API. A generic run failure reason or Loops-board state does not fulfill the settled-run live reason requirement.

**Strategy: `direct`** — A seam already exists in `RunLiveShell.tsx`. The CI job `Lore test-report` will show the red bar for these tests.

## Done when these pass

- [ ] **queries the blocked-reason API and displays it for a settled run with a PR** — renders `RunLiveShell` for a settled run and verifies the fetched reason string appears
  `apps/web-ui/src/app/assembly-runs/[id]/RunPage.acceptance.test.tsx`

## Facets

- [ ] Fetch the per-PR blocked reason using `useSWR` (or similar fetch) in `RunLiveShell.tsx` or a child component
- [ ] Display the blocked reason label from the API response
- [ ] Show a skeleton or loading state until the fetch resolves

## Out of scope

- Real-time updates via WebSocket/SSE (updates happen via React query/SWR invalidation)