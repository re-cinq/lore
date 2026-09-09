// The GitHub Issue lifecycle around a pipeline task: create-or-reuse, the approval-gate park, and the failure comment.

import type { IssueRef } from "@re-cinq/lore-shared";
import type { PipelineTask } from "@re-cinq/lore-shared";
import { errorMessage } from "@re-cinq/lore-shared";
import { linkifyMarkdown } from "@re-cinq/lore-shared";
import type { Project } from "@re-cinq/lore-shared";
import { generateArtifactCopy } from "../../outbound/artifact-copy.js";
import { pipeline } from "../../outbound/queues.js";
import { composeIssueBody } from "./issue-body.js";
import { setStatus, insertEvent } from "./task-helpers.js";

export async function commentTaskFailureOnIssue(
  project: Project,
  issueNumber: number,
  failureReason: string,
  meta: Record<string, unknown>,
): Promise<void> {
  const hint = "hint" in meta && meta.hint ? ` — ${meta.hint}` : "";

  const { issues } = project;

  await issues
    .comment(issueNumber, `Task failed: \`${failureReason}\`${hint}`)
    .catch(() => {});
  await issues.addLabel(issueNumber, "lore-failed").catch(() => {});
}

/** The task an Issue would be filed for, where, and whether it is a feature-lifecycle type (those file their own). */
export interface IssueContext {
  task: PipelineTask;
  targetRepo: string;
  project: Project;
  isFeaturePlanningType: boolean;
}

/** Whether the issue-creation gate says to skip, logging why when the skip is worth reporting (a general task's skip isn't — it never files one by design). */
function shouldSkipIssue(
  { task, targetRepo, isFeaturePlanningType }: IssueContext,
  gate: { create: boolean; reason: string },
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

/** The Issue's generated title and body, with the body's bare references linkified before it is composed. */
async function issueCopy(
  task: PipelineTask,
  targetRepo: string,
): Promise<{ title: string; body: string }> {
  const copy = await generateArtifactCopy({
    kind: "issue",
    taskType: task.task_type,
    description: task.description,
    repo: targetRepo,
  });

  return {
    title: copy.title,
    body: linkifyMarkdown(copy.body, {
      repo: targetRepo,
      uiUrl: process.env.LORE_UI_URL,
    }),
  };
}

/** Opens the Issue with its generated copy. `feature-request` is labeled `spec` rather than by its type — the label is what the merge hooks and the spec-PR handlers key on, and it names the artifact, not the request that asked for it. */
async function openIssue(
  task: PipelineTask,
  targetRepo: string,
  project: Project,
): Promise<IssueRef> {
  const copy = await issueCopy(task, targetRepo);

  return project.issues.create(
    copy.title,
    composeIssueBody(copy.body, task, process.env.LORE_UI_URL),
    [
      "lore-managed",
      task.task_type === "feature-request" ? "spec" : task.task_type,
    ],
  );
}

/** File the Issue this task reports against. Non-fatal: a GitHub App without permission costs the task its Issue, not its run. */
async function createTaskIssue(
  task: PipelineTask,
  targetRepo: string,
  project: Project,
): Promise<number | null> {
  try {
    const issue = await openIssue(task, targetRepo, project);

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
  context: IssueContext,
): Promise<number | null> {
  const { task, targetRepo, project } = context;
  const existing = task.issue_number || null;

  if (existing) {
    console.log(
      `[floor] Using existing issue #${existing} on ${targetRepo} (webhook-dispatched)`,
    );

    return existing;
  }

  const { shouldCreateIssue } = await import("../dark-factory/dark-factory.js");
  const gate = await shouldCreateIssue(task);

  if (shouldSkipIssue(context, gate)) {
    return null;
  }

  return createTaskIssue(task, targetRepo, project);
}

/** The task row and its event, together: a run waiting on a human is only visible once both say so. */
async function parkAwaitingApproval(taskId: string): Promise<void> {
  await setStatus(taskId, "awaiting_approval");
  await insertEvent(taskId, "pending", "awaiting_approval", {
    reason: "approval-required",
  });
}

/** Says on the Issue what the run is waiting for; without the comment and the label a human has no sign the task is parked. */
async function askForApprovalOnIssue(
  project: Project,
  issueNumber: number,
  approvalLabel: string,
): Promise<void> {
  await project.issues.comment(
    issueNumber,
    `This task requires approval before the agent can proceed.\n\nAdd the \`${approvalLabel}\` label to this issue to approve.`,
  );
  await project.issues.addLabel(issueNumber, "awaiting-approval");
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

  await parkAwaitingApproval(task.id);

  if (issueNumber) {
    await askForApprovalOnIssue(project, issueNumber, getApprovalLabel());
  }
  console.log(
    `[floor] Task ${task.id} requires approval — waiting for label on issue #${issueNumber}`,
  );

  return true;
}
