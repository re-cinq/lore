// Reopening the books on a task a FORK resumes (specs/fork-rerun-from-node FR1) — same discipline as settleTaskForLine: pure decision, CAS write, never a throw.

import type { SettleTaskDeps } from "./settle-task.js";

/** Terminal task states a fork reopens — `needs-human-help` included since a human retry IS the help; `merged` is excluded since that work already shipped. */
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

/** Reopens the settled task behind a fork that just started; safe to call for every fork — task-less rows, already-open tasks, and losing racers all no-op. */
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
    // failure_reason cleared with the flip — a running task shouldn't wear the source attempt's failure text.
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
