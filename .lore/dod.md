# Definition of Done

> the linked run-lookup criterion requires one paged walk until every wanted run is found or the list ends. newestRunPerTask instead silently stops after ten pages (500 runs) even when nextCursor still exists. FloorRunReader.taskRunContexts treats the returned partial map as complete. A shown task whose newest run is on page eleven therefore loses its run/Stages despite an available run.

**Strategy: `direct`** — The seam already exists on `FloorRunReader.taskRunContexts` which accepts a floor client, allowing us to mock an 11-page response directly.

## Done when these pass

- [x] **finds a task's run on page eleven of the line, walking past the first ten pages, asking no run by id** — Verifies that `taskRunContexts` continues the walk up to page 11 (bypassing the hard 10-page limit) and finds the task's run without reverting to per-task queries.
  `apps/lore-api/src/work/floor/floor-task-runs.acceptance.test.ts`

## Facets

- [x] Update `newestRunPerTask` in `apps/lore-api/src/work/floor/floor-task-runs.ts` to remove `MAX_PAGES` truncation and walk until all tasks are found or `nextCursor` is exhausted.

## Out of scope

- Adjusting other paginated reads outside of `newestRunPerTask`.