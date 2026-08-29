/**
 * Stale-task safety net.
 *
 * Catches tasks stuck in `running` far beyond any realistic legitimate
 * duration and moves them to `needs-human-help`. Defense against
 * categories of bugs where a task enters `running` but never transitions
 * out — e.g. the 2026-04-17/19 incident where review tasks whose
 * LoreTask returned CHANGES_REQUESTED stayed `running` forever because
 * the watcher forgot to mark them completed (fixed in PR #256).
 *
 * Rationale for the threshold:
 *   - Max legitimate timeoutMinutes in scripts/task-types.yaml is 30
 *     (implementation). Local runner re-queues at 30 min.
 *   - 6 hours is ~12x that — well past any sane retry window for any
 *     task type but still short enough to raise an alert before a weekend.
 *   - We use pipeline.tasks.created_at as the "age" signal (not
 *     updated_at) because watchers keep bumping updated_at on every
 *     tick even when no real progress is happening.
 *
 * Age alone is NOT sufficient, for the same reason the boot-time
 * `recoverStaleTasks` sweep stopped trusting it: a line parked on a HUMAN node
 * legitimately stays open for days, and the task that owns it stays `running`
 * that whole time. Escalating it was worse than a false alarm — it was
 * irreversible: `decideTaskSettlement` only settles a task still in
 * {pending, queued, running}, so when the person finally answered and the line
 * completed, the task stayed at `needs-human-help` forever and the issue was
 * never picked up again. So the open line is consulted first; the clock only
 * decides among tasks nothing is actually working on.
 */

import { projectFor } from "../../composition/project-boot.js";
import { pipeline, taskStore } from "../../kernel/queues.js";

const STALE_THRESHOLD_HOURS = 6;

export interface StaleTaskCheckDeps {
  findStaleRunning(hours: number): Promise<StaleTaskRow[]>;
  /** True while an assembly run for this task is still queued or running —
   *  including one parked on a human node, which is open, not stuck. */
  hasOpenLine(taskId: string): Promise<boolean>;
  escalate(task: StaleTaskRow, ageHours: number): Promise<void>;
}

export interface StaleTaskRow {
  id: string;
  task_type: string;
  target_repo: string;
  issue_number: number | null;
  age_hours: number | string;
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
    // The same read `recoverStaleTasks` binds, deliberately duplicated: "open =
    // queued or running" is spelled out at a dozen sites across the Floor and
    // shared, so single-sourcing it here would leave eleven copies and a helper
    // reachable from two. It is one sweep or none.
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
