/**
 * Promote a task from `awaiting_approval` once a human has put the approval
 * label on its issue.
 *
 * Its data arrives as ports rather than as kernel singletons it imports. That is
 * what lets one registry hold every station: this package is shared with a pod
 * that has no pool, so a station that reached for one could not live here — and
 * the tests below need no database as a consequence.
 *
 * This is a RECONCILER. The fast path is the `github.issues.labeled` event; the
 * sweep exists to catch the delivery that never arrived, because webhooks are
 * lossy and this is cheap and idempotent.
 */

import type { StationHost } from "../lib/station.js";

const WAITING_LABEL = "awaiting-approval";

export async function runApprovalCheck(deps: StationHost): Promise<string> {
  const tasks = await deps.awaitingApproval();

  if (tasks.length === 0) {
    console.log("[station] approval-check: no tasks awaiting approval");

    return "Checked 0 tasks, 0 approved";
  }
  const label = deps.approvalLabel();
  let approved = 0;

  for (const task of tasks) {
    // Per task, so one unreachable repo cannot stall every other repo's queue.
    try {
      const repo = await deps.repoFor(task.target_repo);

      if (!(await repo.labelsOn(task.issue_number)).includes(label)) {
        continue;
      }

      await repo.approve(task.id);
      // Best-effort tidy-up: the transition above is the real work, and failing
      // to remove a label must not re-run it on the next sweep.
      await repo.removeLabel(task.issue_number, WAITING_LABEL).catch(() => {});
      await repo
        .comment(
          task.issue_number,
          "Task approved. Agent will pick it up shortly.",
        )
        .catch(() => {});

      approved++;
      console.log(`[station] approval-check: task ${task.id} approved`);
    } catch (err) {
      console.error(
        `[station] approval-check: error checking task ${task.id}:`,
        err,
      );
    }
  }

  return `Checked ${tasks.length} tasks, ${approved} approved`;
}
