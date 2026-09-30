// What a rerun of the issues station does to the spec-tasks a plan already has: the spec-task on a task's issue (or, filed before task issues existed, with its task id) is reused rather than duplicated, and one the new decomposition dropped is cancelled — so a plan never holds two spec-tasks for one task, and its group can still all merge. Pure.

export interface ExistingSpecTask {
  id: string;
  status: string;
  issueNumber: number | null;
  specTaskId?: string;
  /** The PR its line recorded when it settled; null when none was. */
  prNumber?: number | null;
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

  const current = new Set(wanted.map((task) => task.issueNumber));

  for (const task of wanted) {
    placeWanted(plan, task, takeMatch(unmatched, task, current));
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

  (REQUEUE.has(match.status) || completedWithoutPr(match)
    ? plan.requeue
    : plan.update
  ).push({
    id: match.id,
    wanted,
  });
}

// The spec-task already on the task's issue, else one with its task id whose issue is none of the plan's current task issues — filed before task issues existed, or on a first attempt's issue (#2245–#2251 for the issue-triage plan); removed from `unmatched` so no row serves two tasks.
function takeMatch(
  unmatched: ExistingSpecTask[],
  task: WantedSpecTask,
  current: ReadonlySet<number>,
): ExistingSpecTask | undefined {
  const index = [
    unmatched.findIndex((row) => row.issueNumber === task.issueNumber),
    unmatched.findIndex(
      (row) =>
        row.specTaskId === task.specTaskId &&
        (row.issueNumber === null || !current.has(row.issueNumber)),
    ),
  ].find((i) => i >= 0);

  return index === undefined ? undefined : unmatched.splice(index, 1)[0];
}

// A spec-task's line records its PR when it settles `completed`, and the merge check then follows that PR to merged or failed; a `completed` row with no PR recorded is from before that, and nothing says its work exists — run 18773dbb's T001 and T010 read "completed" after their PRs were closed unmerged, and T011 would have started on a verify node that was never built.
function completedWithoutPr(match: ExistingSpecTask): boolean {
  return match.status === "completed" && match.prNumber === null;
}
