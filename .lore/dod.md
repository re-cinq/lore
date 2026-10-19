# Definition of Done

> Separately, `lore_retry_task` on a backlog-loop task does nothing useful (it joins the open `backlog` run and opens a duplicate issue). It should either refuse and point at removing `lore:blocked`, or re-queue the same issue.

**Strategy: `direct`** — The seam already exists. The acceptance test can call the real entry point `retryTask` directly. The red bar is CI's to show, as the local vitest runner is absent in this pod. The CI job that runs the tests is `test` or `Node.js CI`.

## Done when these pass

- [ ] **refuses to retry an implementation-loop task and points at removing lore:blocked** — `retryTask` rejects the retry attempt with an error message mentioning `lore:blocked` when the task type is `implementation-loop`.
  `libs/shared/src/domain/pipeline-task-actions.acceptance.test.ts`

## Facets

- [ ] `retryTask` checks if `task.task_type === "implementation-loop"` and throws an error if true.
- [ ] The error message tells the user to remove the `lore:blocked` label.

## Out of scope

- The first half of the issue regarding `activeTaskByIssue` not excluding `retried` and `completed` tasks was already resolved by PR #2045 and PR #2822.
