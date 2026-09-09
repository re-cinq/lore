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
/** Flips a settled task back to running for a fork's rerun, and records the transition. CAS-guarded on the status we read: another delivery may have moved the task since, and losing that race means somebody else already owns it. `failure_reason` is cleared with the flip — a running task should not wear the source attempt's failure text. */
async function reopen(
  assemblyRunId: string,
  taskId: string,
  deps: { tasks: SettleTaskDeps["tasks"] },
): Promise<void> {
  const task = await deps.tasks.getById(taskId);

  if (!task) {
    return;
  }
  const reopenTo = decideTaskReopen(task.status);

  if (!reopenTo) {
    return;
  }
  await flipToRunning(task, reopenTo, assemblyRunId, deps);
}

/** CAS-guarded flip plus its transition record; a lost race means another delivery already owns the task, so it writes nothing. */
async function flipToRunning(
  task: { id: string; status: string },
  reopenTo: "running",
  assemblyRunId: string,
  deps: { tasks: SettleTaskDeps["tasks"] },
): Promise<void> {
  const won = await deps.tasks.setStatusIf(task.id, task.status, reopenTo, {
    failure_reason: null,
  });

  if (!won) {
    return;
  }
  await deps.tasks.recordEvent(task.id, task.status, reopenTo, {
    assembly_run_id: assemblyRunId,
    reason: "fork-rerun",
  });
}

export async function reopenTaskForFork(
  row: { id: string; taskId: string | null },
  deps: { tasks: SettleTaskDeps["tasks"] },
): Promise<void> {
  if (!row.taskId) {
    return;
  }

  try {
    await reopen(row.id, row.taskId, deps);
  } catch (err) {
    console.error(
      `[reopen-task] fork ${row.id} → task ${row.taskId}: ${(err as Error).message}`,
    );
  }
}
