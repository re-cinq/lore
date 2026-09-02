// Reopening the books on a task a FORK resumes — settle-task's start-side twin.
//
// A fork inherits its source's taskId (specs/fork-rerun-from-node FR1), and the
// source's terminal walk already settled that task, usually `failed`. Nothing
// wrote the resumption back: the task-keyed surfaces (the implementation-loop
// page's "current" ticket, the task page) kept reporting the settled state while
// the fork's walk ran, and — worse — a failed loop task stops guarding its
// issue, so the backlog driver could pick the same ticket into a second task
// while the fork works the first.
//
// Same discipline as settleTaskForLine: pure decision, CAS write so a losing
// racer or redelivered start event is a no-op, and never a throw out of it.

import type { SettleTaskDeps } from "./settle-task.js";

/** Terminal task states a fork reopens — `needs-human-help` included, because
 *  a human retrying from the run page IS the help the task was waiting for.
 *  Open states are a duplicate delivery's no-op; `merged` is past reopening —
 *  that work shipped, and a fork over it is a rerun someone owns deliberately,
 *  not the task coming back. */
const REOPENABLE = new Set([
  "failed",
  "cancelled",
  "completed",
  "needs-human-help",
]);

/** What a fork's start means for the inherited task. null = leave it alone. */
export function decideTaskReopen(taskStatus: string): "running" | null {
  return REOPENABLE.has(taskStatus) ? "running" : null;
}

/**
 * Reopen the settled task behind a fork that just started. Safe to call for
 * every fork: task-less rows, already-open tasks and losing racers all no-op.
 */
export async function reopenTaskForFork(
  row: { id: string; taskId: string | null },
  deps: { tasks: SettleTaskDeps["tasks"] },
): Promise<void> {
  if (!row.taskId) {
    return;
  }

  try {
    const task = await deps.tasks.getById(row.taskId);

    if (!task) {
      return;
    }
    const previousStatus = task.status;
    const reopenTo = decideTaskReopen(previousStatus);

    if (!reopenTo) {
      return;
    }
    // failure_reason cleared with the flip: a running task wearing the source
    // attempt's failure text would read as failing all over again.
    const won = await deps.tasks.setStatusIf(
      task.id,
      previousStatus,
      reopenTo,
      {
        failure_reason: null,
      },
    );

    if (!won) {
      return;
    }
    await deps.tasks.recordEvent(task.id, previousStatus, reopenTo, {
      assembly_run_id: row.id,
      reason: "fork-rerun",
    });
  } catch (err) {
    console.error(
      `[reopen-task] fork ${row.id} → task ${row.taskId}: ${(err as Error).message}`,
    );
  }
}
