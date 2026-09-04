// The GitHub Issue lifecycle around a pipeline task: create-or-reuse, the approval-gate park, and the failure comment.

import type { PipelineTask } from "@re-cinq/lore-shared";
import { errorMessage } from "@re-cinq/lore-shared";
import { linkifyMarkdown } from "@re-cinq/lore-shared";
import type { Project } from "@re-cinq/lore-shared";
import { generateArtifactCopy } from "../lib/artifact-copy.js";
import { pipeline } from "../../kernel/queues.js";
import { composeIssueBody } from "./issue-body.js";
import { setStatus, insertEvent } from "./task-helpers.js";

export async function commentTaskFailureOnIssue(
  project: Project,
  issueNumber: number,
  failureReason: string,
  meta: Record<string, unknown>,
): Promise<void> {
  const hint = "hint" in meta && meta.hint ? ` — ${meta.hint}` : "";

  await project.issues
    .comment(issueNumber, `Task failed: \`${failureReason}\`${hint}`)
    .catch(() => {});
  await project.issues.addLabel(issueNumber, "lore-failed").catch(() => {});
}

/** Whether the issue-creation gate says to skip, logging why when the skip is worth reporting (a general task's skip isn't — it never files one by design). */
function shouldSkipIssue(
  task: PipelineTask,
  isFeaturePlanningType: boolean,
  gate: { create: boolean; reason: string },
  targetRepo: string,
): boolean {
  // A general task never files one, and a feature-planning line files its own.
  const eligible = task.task_type !== "general" && !isFeaturePlanningType;
  const skip = !eligible || !gate.create;
  const skipIsNoteworthy = task.task_type !== "general";

  if (skip && skipIsNoteworthy) {
    console.log(
      `[floor] Skipping issue for ${targetRepo} task ${task.id} (dark-factory: ${gate.reason})`,
    );
  }

  return skip;
}

/** File the Issue this task reports against. Non-fatal: a GitHub App without permission costs the task its Issue, not its run. */
async function createTaskIssue(
  task: PipelineTask,
  targetRepo: string,
  project: Project,
): Promise<number | null> {
  try {
    const copy = await generateArtifactCopy({
      kind: "issue",
      taskType: task.task_type,
      description: task.description,
      repo: targetRepo,
    });
    const issueBody = linkifyMarkdown(copy.body, {
      repo: targetRepo,
      uiUrl: process.env.LORE_UI_URL,
    });
    const issue = await project.issues.create(
      copy.title,
      composeIssueBody(issueBody, task, process.env.LORE_UI_URL),
      [
        "lore-managed",
        task.task_type === "feature-request" ? "spec" : task.task_type,
      ],
    );

    await pipeline().taskQueue.setColumns(task.id, {
      issue_number: issue.number,
      issue_url: issue.url,
    });
    console.log(`[floor] Created issue #${issue.number} on ${targetRepo}`);

    return issue.number;
  } catch (err) {
    console.warn(
      `[floor] Could not create issue on ${targetRepo}: ${errorMessage(err)}`,
    );

    return null;
  }
}

/** Existing, new, or no Issue: dark mode defers creation per `create_issue` unless `with_issue: true` forces it (FR3.2). */
export async function ensureIssue(
  task: PipelineTask,
  targetRepo: string,
  project: Project,
  isFeaturePlanningType: boolean,
): Promise<number | null> {
  const existing = task.issue_number || null;

  if (existing) {
    console.log(
      `[floor] Using existing issue #${existing} on ${targetRepo} (webhook-dispatched)`,
    );

    return existing;
  }

  const { shouldCreateIssue } = await import("../dark-factory/dark-factory.js");
  const gate = await shouldCreateIssue(task);

  if (shouldSkipIssue(task, isFeaturePlanningType, gate, targetRepo)) {
    return null;
  }

  return createTaskIssue(task, targetRepo, project);
}

/** Parks the task at `awaiting_approval` and returns true when the repo gates this type (FR3.2). */
export async function awaitApprovalIfRequired(
  task: PipelineTask,
  targetRepo: string,
  project: Project,
  issueNumber: number | null,
): Promise<boolean> {
  const { requiresApproval, getApprovalLabel } =
    await import("@re-cinq/lore-shared");

  if (!requiresApproval(task.task_type, targetRepo)) {
    return false;
  }

  await setStatus(task.id, "awaiting_approval");
  await insertEvent(task.id, "pending", "awaiting_approval", {
    reason: "approval-required",
  });

  if (issueNumber) {
    await project.issues.comment(
      issueNumber,
      `This task requires approval before the agent can proceed.\n\nAdd the \`${getApprovalLabel()}\` label to this issue to approve.`,
    );
    await project.issues.addLabel(issueNumber, "awaiting-approval");
  }
  console.log(
    `[floor] Task ${task.id} requires approval — waiting for label on issue #${issueNumber}`,
  );

  return true;
}
