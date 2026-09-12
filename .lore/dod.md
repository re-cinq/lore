# Definition of Done

> `TaskQueueRepository.activeTaskByIssue` treats every status except `failed`/`cancelled` as active. Running `lore_retry_task` on the ticket's failed task set the original to `retried`, so `pickBacklogTicket` guarded #85 on every tick.

**Strategy: `direct`** — The `InMemoryTaskQueue` is the declared behavioral spec of the Pg adapter, and `activeTaskByIssue` is a public method on it. Tests can call it directly and assert the wrong return value today.

## Done when these pass

- [ ] **InMemory returns null for a retried task** — `activeTaskByIssue` returns null when the task's status is `retried`; currently returns `{ id: "t1" }`.
  `libs/shared/src/outbound/project/tasks/task-queue.test.ts`

- [ ] **InMemory returns null for a completed task** — `activeTaskByIssue` returns null when the task's status is `completed`; currently returns `{ id: "t1" }`.
  `libs/shared/src/outbound/project/tasks/task-queue.test.ts`

- [ ] **PgTaskQueue SQL excludes retried from active statuses** — the SQL query sent by `activeTaskByIssue` must contain `retried` (either as part of a NOT IN list or an IN allowlist), so that the Postgres path matches the in-memory fix.
  `libs/shared/src/outbound/project/tasks/task-queue.test.ts`

## Facets

- [ ] Change `activeTaskByIssue` in `InMemoryTaskQueue` (`task-queue-memory.ts`) to also exclude `retried` and `completed` from the active set — either extend the NOT IN check or switch to a positive IN allowlist.
- [ ] Mirror the change in `PgTaskQueue` (`task-queue-pg.ts`) — update the SQL `NOT IN ('failed', 'cancelled')` clause to also exclude `retried` and `completed`.
- [ ] Update the port docstring on `activeTaskByIssue` in `task-queue-port.ts` to reflect the corrected set of terminal statuses.

## Out of scope

- The second part of the ticket ("`lore_retry_task` on a backlog-loop task should refuse and point at removing `lore:blocked`") — that is a separate behaviour on the retry tool, not on `activeTaskByIssue`.
- Any changes to how `retried` status is set or what triggers it.
- Changes to the `setStatusIf` / status transition machinery.
