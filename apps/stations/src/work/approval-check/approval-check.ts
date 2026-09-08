// Promotes a task from `awaiting_approval` once its issue gets the approval label. Data arrives as ports (no kernel singletons) since this package is shared with a pod with no pool. A RECONCILER: the fast path is the `github.issues.labeled` event; the sweep catches deliveries that never arrive (webhooks are lossy).

import type { StationHost } from "../lib/station.js";

const WAITING_LABEL = "awaiting-approval";

/** Promotes one task if its issue carries the label. The transition is the real work — the label removal and the comment are best-effort, because a failure there must not make the next sweep approve the task a second time. */
async function promoteIfApproved(
  deps: StationHost,
  task: { id: string; target_repo: string; issue_number: number },
  label: string,
): Promise<boolean> {
  const repo = await deps.repoFor(task.target_repo);

  if (!(await repo.labelsOn(task.issue_number)).includes(label)) {
    return false;
  }

  await repo.approve(task.id);
  await repo.removeLabel(task.issue_number, WAITING_LABEL).catch(() => {});
  await repo
    .comment(task.issue_number, "Task approved. Agent will pick it up shortly.")
    .catch(() => {});

  console.log(`[station] approval-check: task ${task.id} approved`);

  return true;
}

// Whether this task was promoted. Caught per task, so one unreachable repo cannot stall every other repo's queue — an error reads as "not approved yet", which the next tick will revisit.
async function checkedApproval(
  deps: StationHost,
  task: Parameters<typeof promoteIfApproved>[1],
  label: string,
): Promise<boolean> {
  try {
    return await promoteIfApproved(deps, task, label);
  } catch (err) {
    console.error(
      `[station] approval-check: error checking task ${task.id}:`,
      err,
    );

    return false;
  }
}

export async function runApprovalCheck(deps: StationHost): Promise<string> {
  const tasks = await deps.awaitingApproval();

  if (tasks.length === 0) {
    console.log("[station] approval-check: no tasks awaiting approval");

    return "Checked 0 tasks, 0 approved";
  }
  const label = deps.approvalLabel();
  let approved = 0;

  for (const task of tasks) {
    if (await checkedApproval(deps, task, label)) {
      approved++;
    }
  }

  return `Checked ${tasks.length} tasks, ${approved} approved`;
}
