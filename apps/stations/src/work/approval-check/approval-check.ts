// Promotes a task from `awaiting_approval` once its issue gets the approval label. Data arrives as ports (no kernel singletons) since this package is shared with a pod with no pool. A RECONCILER: the fast path is the `github.issues.labeled` event; the sweep catches deliveries that never arrive (webhooks are lossy).

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
      // Best-effort tidy-up: the transition above is the real work, and a failed label removal must not re-run it next sweep.
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
