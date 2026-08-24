// Moved from the Floor unchanged (ADR-024's service-endpoint station form): a
// cron sweep is a unit of work with one clear result, and it needed none of what
// a pod gives an assembly-line node. Only its imports changed.

import { getApprovalLabel } from "@re-cinq/lore-shared";
import { pipeline } from "../kernel/queues.js";
import { projectFor } from "../kernel/project-boot.js";

export async function approvalCheckJob(): Promise<string> {
  const tasks = await pipeline().taskQueue.awaitingApproval();

  if (tasks.length === 0) {
    console.log("[job] approval-check: no tasks awaiting approval");

    return "Checked 0 tasks, 0 approved";
  }

  const approvalLabel = getApprovalLabel();
  let approvedCount = 0;

  for (const task of tasks) {
    try {
      const project = await projectFor(task.target_repo);
      const labels = await project.issues.getLabels(task.issue_number);

      if (labels.includes(approvalLabel)) {
        // Transition: awaiting_approval → pending
        await project.tasks.setStatus(task.id, "pending");
        await project.tasks.recordEvent(
          task.id,
          "awaiting_approval",
          "pending",
          {
            reason: "approved-via-label",
          },
        );

        // Remove the awaiting-approval label and add approved
        await project.issues
          .removeLabel(task.issue_number, "awaiting-approval")
          .catch(() => {});
        await project.issues
          .comment(
            task.issue_number,
            "Task approved. Agent will pick it up shortly.",
          )
          .catch(() => {});

        approvedCount++;
        console.log(`[job] approval-check: task ${task.id} approved via label`);
      }
    } catch (err) {
      console.error(
        `[job] approval-check: error checking task ${task.id}:`,
        err,
      );
    }
  }

  return `Checked ${tasks.length} tasks, ${approvedCount} approved`;
}
