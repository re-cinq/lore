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
  /** Stopped short of a PR: rewritten and put back to pending. */
  requeue: { id: string; wanted: W }[];
  /** Live or done: rewritten, status kept. */
  update: { id: string; wanted: W }[];
  create: W[];
  cancel: string[];
}

const REQUEUE = new Set(["failed", "cancelled", "retried", "needs-human-help"]);
// Not started, or stopped short: nothing is lost by cancelling these once their task is gone. A running one is left to finish.
const CANCELLABLE = new Set([
  "pending",
  "queued",
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
  const plan: SpecTaskReconcile<W> = {
    requeue: [],
    update: [],
    create: [],
    cancel: [],
  };

  for (const task of wanted) {
    placeWanted(plan, task, takeMatch(unmatched, task));
  }
  plan.cancel = unmatched
    .filter((row) => CANCELLABLE.has(row.status))
    .map((row) => row.id);

  return plan;
}

// A merged match is done and gets nothing.
function placeWanted<W extends WantedSpecTask>(
  plan: SpecTaskReconcile<W>,
  wanted: W,
  match: ExistingSpecTask | undefined,
): void {
  if (!match) {
    plan.create.push(wanted);

    return;
  }

  if (match.status === "merged") {
    return;
  }

  (REQUEUE.has(match.status) ? plan.requeue : plan.update).push({
    id: match.id,
    wanted,
  });
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
