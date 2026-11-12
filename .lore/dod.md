# Definition of Done

> Task-backed runs have the agreed Task accounting grouping, including the status-transition history required by FR4.

**Strategy: `direct`** — The seam already exists; we can mount `RunLiveShell` with a task and directly observe the rendered output structure.

## Done when these pass

- [x] **Task accounting layout** — Task-backed runs render EventTimeline and LlmCallsTable under a "Task accounting" heading
  `apps/web-ui/src/app/assembly-runs/[id]/task-accounting.acceptance.test.tsx`

## Facets

- [x] Create an `EventTimeline` component or retrieve the existing one if moved.
- [x] Update `TaskContextSection` in `RunLiveShell.tsx` to group `EventTimeline` and `LlmCallsTable` under an `h2` or `h3` named "Task accounting".

## Out of scope

- Updating `TaskLessRunAlert`, as it already correctly handles task-less runs by showing an alert without the heading.
