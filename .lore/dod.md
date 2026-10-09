# Definition of Done

> claimNextPending has no callers since apps/floor was deleted

**Strategy: `mechanical`** — The ticket is a fully-specified dead code deletion (the method, adapters, and tests), covered by existing tests staying green.

## Done when these pass

- [x] **`task-queue.test.ts`** — The remaining org-wide sweep reads and queue behaviours stay green without `claimNextPending`.
  `libs/shared/src/outbound/project/tasks/task-queue.test.ts`

## Facets

- [x] Delete `claimNextPending` from `TaskQueueRepository` port.
- [x] Delete `claimNextPending` adapter in `task-queue-pg.ts`.
- [x] Delete `claimNextPending` adapter in `task-queue-memory.ts`.
- [x] Delete `claimNextPending` tests from `task-queue.test.ts`.
- [x] Rewrite `specs/1-lore-platform` FR-20.1 and FR-20.2 to remove claim semantics and align validation links.

## Out of scope

- Removing other spec-task fields or methods not tied to `claimNextPending`.
