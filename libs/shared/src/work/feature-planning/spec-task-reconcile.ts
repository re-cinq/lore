// What a rerun of the issues station does to the spec-tasks a plan already has: the spec-task on a task's issue (or, filed before task issues existed, with its task id) is reused rather than duplicated, and one the new decomposition dropped is cancelled — so a plan never holds two spec-tasks for one task, and its group can still all merge. Pure.

export interface ExistingSpecTask {
  id: string;
  status: string;
  issueNumber: number | null;
  specTaskId?: string;
}

export interface WantedSpecTask {
  specTaskId: string;
  issueNumber: number;
}

export interface SpecTaskReconcile<W extends WantedSpecTask> {
  /** `requeue` puts a task that stopped short back to pending; a live one keeps its status. */
  update: { id: string; wanted: W; requeue: boolean }[];
  create: W[];
  cancel: string[];
}

// Stopped short of a PR: a rerun gives these another go.
const REQUEUE = new Set(["failed", "cancelled", "retried", "needs-human-help"]);
// Not started, or stopped short: nothing is lost by cancelling these once their task is gone. A running one is left to finish.
const CANCELLABLE = new Set([
  "pending",
  "awaiting_approval",
  "failed",
  "retried",
  "needs-human-help",
]);

export function planSpecTaskReconcile<W extends WantedSpecTask>(
  existing: readonly ExistingSpecTask[],
  wanted: readonly W[],
): SpecTaskReconcile<W> {
  const unmatched = [...existing];
  const plan: SpecTaskReconcile<W> = { update: [], create: [], cancel: [] };

  for (const task of wanted) {
    const match = takeMatch(unmatched, task);

    if (!match) {
      plan.create.push(task);
    } else if (match.status !== "merged") {
      plan.update.push({
        id: match.id,
        wanted: task,
        requeue: REQUEUE.has(match.status),
      });
    }
  }
  plan.cancel = unmatched
    .filter((task) => CANCELLABLE.has(task.status))
    .map((task) => task.id);

  return plan;
}

// The spec-task already on the task's issue, else one with its task id and no issue yet; removed from `unmatched` so no row serves two tasks.
function takeMatch(
  unmatched: ExistingSpecTask[],
  task: WantedSpecTask,
): ExistingSpecTask | undefined {
  const index = [
    unmatched.findIndex((row) => row.issueNumber === task.issueNumber),
    unmatched.findIndex(
      (row) => row.issueNumber === null && row.specTaskId === task.specTaskId,
    ),
  ].find((i) => i >= 0);

  return index === undefined ? undefined : unmatched.splice(index, 1)[0];
}
