import { query } from "../db.js";
import { platform } from "../platform.js";
import { getApprovalLabel } from "../approval.js";

interface AwaitingTask {
  id: string;
  target_repo: string;
  issue_number: number;
}

export async function approvalCheckJob(): Promise<string> {
  const tasks = await query<AwaitingTask>(
    `SELECT id, target_repo, issue_number FROM pipeline.tasks
     WHERE status = 'awaiting_approval' AND issue_number IS NOT NULL`
  );

  if (tasks.length === 0) {
    console.log("[job] approval-check: no tasks awaiting approval");
    return "Checked 0 tasks, 0 approved";
  }

  const approvalLabel = getApprovalLabel();
  let approvedCount = 0;

  for (const task of tasks) {
    try {
      const labels = await platform().getIssueLabels(task.target_repo, task.issue_number);

      if (labels.includes(approvalLabel)) {
        // Transition: awaiting_approval → pending
        await query(
          `UPDATE pipeline.tasks SET status = 'pending', updated_at = now() WHERE id = $1`,
          [task.id]
        );
        await query(
          `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata)
           VALUES ($1, $2, $3, $4)`,
          [task.id, "awaiting_approval", "pending", JSON.stringify({ reason: "approved-via-label" })]
        );

        // Remove the awaiting-approval label and add approved
        await platform().removeIssueLabel(task.target_repo, task.issue_number, "awaiting-approval").catch(() => {});
        await platform().commentOnIssue(
          task.target_repo,
          task.issue_number,
          "Task approved. Agent will pick it up shortly."
        ).catch(() => {});

        approvedCount++;
        console.log(`[job] approval-check: task ${task.id} approved via label`);
      }
    } catch (err) {
      console.error(`[job] approval-check: error checking task ${task.id}:`, err);
    }
  }

  return `Checked ${tasks.length} tasks, ${approvedCount} approved`;
}
