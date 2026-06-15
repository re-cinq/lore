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
 */

import { query } from "../../platform/db.js";
import { projectFor } from "../../platform/project-boot.js";

const STALE_THRESHOLD_HOURS = 6;

interface StaleTask {
  id: string;
  target_repo: string;
  task_type: string;
  created_at: string;
  issue_number: number | null;
  age_hours: number;
}

export async function staleTaskCheckJob(): Promise<string> {
  const rows = await query<StaleTask>(
    `SELECT id,
            target_repo,
            task_type,
            created_at,
            issue_number,
            EXTRACT(EPOCH FROM (now() - created_at)) / 3600 AS age_hours
     FROM pipeline.tasks
     WHERE status = 'running'
       AND created_at < now() - ($1 || ' hours')::interval`,
    [String(STALE_THRESHOLD_HOURS)],
  );

  if (rows.length === 0) {
    return `No stale tasks (threshold ${STALE_THRESHOLD_HOURS}h)`;
  }

  let escalated = 0;
  for (const task of rows) {
    try {
      const ageHoursRounded = Math.round(Number(task.age_hours) * 10) / 10;
      await query(
        `UPDATE pipeline.tasks
         SET status = 'needs-human-help',
             failure_reason = $2,
             updated_at = now()
         WHERE id = $1 AND status = 'running'`,
        [task.id, `Stuck in 'running' for ${ageHoursRounded}h — safety-net timeout at ${STALE_THRESHOLD_HOURS}h`],
      );
      await query(
        `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata)
         VALUES ($1, 'running', 'needs-human-help', $2)`,
        [task.id, JSON.stringify({
          reason: "stale-timeout",
          age_hours: ageHoursRounded,
          threshold_hours: STALE_THRESHOLD_HOURS,
          detected_by: "stale-task-check",
        })],
      ).catch(() => {});

      if (task.issue_number) {
        const project = await projectFor(task.target_repo);
        await project.issues.comment(
          task.issue_number,
          `Task has been in \`running\` status for ${ageHoursRounded}h — exceeded the ${STALE_THRESHOLD_HOURS}h safety-net threshold. Auto-escalated to \`needs-human-help\`. Task id: \`${task.id}\`.`,
        ).catch(() => {});
        await project.issues.addLabel(task.issue_number, "needs-human-help").catch(() => {});
      }

      escalated++;
      console.log(`[stale-task-check] escalated ${task.id} (${task.task_type} on ${task.target_repo}, age ${ageHoursRounded}h)`);
    } catch (err) {
      console.error(`[stale-task-check] error escalating ${task.id}:`, err);
    }
  }

  return `Escalated ${escalated}/${rows.length} stale tasks (threshold ${STALE_THRESHOLD_HOURS}h)`;
}
