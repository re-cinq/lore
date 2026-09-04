/** Stale-task safety net (6h threshold): moves stuck-running tasks to needs-human-help, consulting open lines first. */

import { projectFor } from "../../composition/project-boot.js";
import { pipeline, taskStore } from "../../kernel/queues.js";
import type { StaleTask } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";

const STALE_THRESHOLD_HOURS = 6;

export type StaleTaskRow = StaleTask;

export interface StaleTaskCheckDeps {
  findStaleRunning(hours: number): Promise<StaleTaskRow[]>;
  /** True while an assembly run is queued/running/parked on human node (open, not stuck). */
  hasOpenLine(taskId: string): Promise<boolean>;
  escalate(task: StaleTaskRow, ageHours: number): Promise<void>;
}

export async function staleTaskCheckJob(
  deps: StaleTaskCheckDeps = productionDeps(),
): Promise<string> {
  const rows = await deps.findStaleRunning(STALE_THRESHOLD_HOURS);

  if (rows.length === 0) {
    return `No stale tasks (threshold ${STALE_THRESHOLD_HOURS}h)`;
  }

  let escalated = 0;
  let parked = 0;

  for (const task of rows) {
    try {
      // The line is the authority on whether work is still in flight.
      if (await deps.hasOpenLine(task.id)) {
        parked++;
        continue;
      }
      const ageHoursRounded = Math.round(Number(task.age_hours) * 10) / 10;

      await deps.escalate(task, ageHoursRounded);
      escalated++;
      console.log(
        `[stale-task-check] escalated ${task.id} (${task.task_type} on ${task.target_repo}, age ${ageHoursRounded}h)`,
      );
    } catch (err) {
      console.error(`[stale-task-check] error escalating ${task.id}:`, err);
    }
  }

  return `Escalated ${escalated}/${rows.length} stale tasks, ${parked} still walking (threshold ${STALE_THRESHOLD_HOURS}h)`;
}

/** The real escalation: flip the row, record it, and tell the Issue. */
function productionDeps(): StaleTaskCheckDeps {
  return {
    findStaleRunning: (hours) => pipeline().taskQueue.findStaleRunning(hours),
    // Deliberately duplicated read; "open = queued or running" is common pattern; one sweep or none
    hasOpenLine: async (taskId) =>
      (await pipeline().assemblyRuns.listForTask(taskId)).some(
        (line) => line.status === "running" || line.status === "queued",
      ),
    escalate: (task, ageHoursRounded) =>
      escalateStaleTask(task, ageHoursRounded),
  };
}

async function escalateStaleTask(
  task: StaleTaskRow,
  ageHoursRounded: number,
): Promise<void> {
  await taskStore().setStatusIf(task.id, "running", "needs-human-help", {
    failure_reason: `Stuck in 'running' for ${ageHoursRounded}h — safety-net timeout at ${STALE_THRESHOLD_HOURS}h`,
  });
  await taskStore()
    .recordEvent(task.id, "running", "needs-human-help", {
      reason: "stale-timeout",
      age_hours: ageHoursRounded,
      threshold_hours: STALE_THRESHOLD_HOURS,
      detected_by: "stale-task-check",
    })
    .catch(() => {});

  if (!task.issue_number) {
    return;
  }
  const project = await projectFor(task.target_repo);

  await project.issues
    .comment(
      task.issue_number,
      `Task has been in \`running\` status for ${ageHoursRounded}h — exceeded the ${STALE_THRESHOLD_HOURS}h safety-net threshold. Auto-escalated to \`needs-human-help\`. Task id: \`${task.id}\`.`,
    )
    .catch(() => {});
  await project.issues
    .addLabel(task.issue_number, "needs-human-help")
    .catch(() => {});
}
