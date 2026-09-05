// Closing out a succeeded run that produced no code changes — the completion routes through the task's GitHub Issue instead of a PR.
import { writeEpisode, errorMessage } from "@re-cinq/lore-shared";
import { projectFor } from "../../kernel/project-boot.js";
import { memoryLifecycle, pipeline, taskStore } from "../../kernel/queues.js";
import { generateArtifactCopy } from "../lib/artifact-copy.js";
import { taskPageUrl } from "../lib/agent-watcher-logic.js";
import {
  type AgentContext,
  getIssueNumber,
  notifyTaskUpdate,
  tailOutput,
} from "./agent-watcher-notify.js";

/** feature-planning posts its result straight to the features API (ADR-027). */
export async function completeFeaturePlanningTask(
  taskId: string,
): Promise<void> {
  try {
    await taskStore().setStatus(taskId, "completed");
    await taskStore().recordEvent(taskId, "running", "completed", {
      feature_planning: true,
    });
  } catch (err) {
    console.error(
      `[agent-watcher] feature-planning completion failed for ${taskId}: ${errorMessage(err)}`,
    );
  }
}

interface NoChangeIssueTarget {
  taskId: string;
  taskType: string;
  targetRepo: string;
  description: string;
  output: string;
}

/** Opens the no-changes Issue; best-effort — a failure here just leaves `issue_number` null. */
async function createNoChangeIssue(
  target: NoChangeIssueTarget,
  logsRef: string,
): Promise<number | null> {
  try {
    const copy = await generateArtifactCopy({
      kind: "issue",
      taskType: target.taskType,
      description: target.description,
      agentOutput: target.output,
      repo: target.targetRepo,
    });
    const body = target.output
      ? `${tailOutput(target.output)}\n\n---\n*Lore-Task: ${target.taskId}*`
      : `${copy.body}\n\nTask completed (no output). ${logsRef}.`;
    const issue = await (
      await projectFor(target.targetRepo)
    ).issues.create(copy.title, body, ["lore-managed", target.taskType]);

    await pipeline().taskQueue.setColumns(target.taskId, {
      issue_number: issue.number,
      issue_url: issue.url,
    });

    return issue.number;
  } catch {
    return null;
  }
}

async function commentNoChangeOnIssue(
  targetRepo: string,
  issueNumber: number,
  output: string,
  logsRef: string,
): Promise<void> {
  const body = output
    ? `## Result\n\n${tailOutput(output)}`
    : `Task completed (no code changes). ${logsRef} for full output.`;

  await projectFor(targetRepo)
    .then((p) => p.issues.comment(issueNumber, body))
    .catch(() => {});
}

/** Comments on the existing issue, or opens a fresh one when there isn't one yet. */
async function resolveOrCreateIssueNumber(
  existingIssueNumber: number | null,
  target: NoChangeIssueTarget,
  logsRef: string,
): Promise<number | null> {
  if (existingIssueNumber) {
    await commentNoChangeOnIssue(
      target.targetRepo,
      existingIssueNumber,
      target.output,
      logsRef,
    );

    return existingIssueNumber;
  }

  return createNoChangeIssue(target, logsRef);
}

async function recordNoChangeCompletion(
  ctx: AgentContext,
  taskUrl: ReturnType<typeof taskPageUrl>,
  targetRepo: string,
  issueNumber: number | null,
): Promise<void> {
  const { taskId, taskType, description, output } = ctx;

  await taskStore().setStatus(taskId, "completed", { log_url: taskUrl });
  await taskStore().recordEvent(taskId, "running", "completed", {
    no_changes: true,
    issue_number: issueNumber,
  });

  if (issueNumber) {
    await notifyTaskUpdate(
      taskId,
      targetRepo,
      "completed",
      `https://github.com/${targetRepo}/issues/${issueNumber}`,
    );
  }
  writeEpisode(
    { memory: memoryLifecycle() },
    {
      content: `Task ${taskType} on ${targetRepo} completed (no changes)\nDescription: ${description.substring(0, 500)}\nOutput: ${output.substring(0, 2000)}`,
      source: "ci",
      ref: `${targetRepo}/${taskId}`,
    },
  ).catch(() => {});
  console.log(
    `[agent-watcher] Task ${taskId} completed → issue #${issueNumber || "none"}`,
  );
}

/** Closes out a succeeded no-changes task, routing the result through its GitHub Issue. */
export async function completeNoChangeTask(
  ctx: AgentContext,
  taskUrl: ReturnType<typeof taskPageUrl>,
  logsRef: string,
): Promise<void> {
  const { taskId, taskType, targetRepo, description, output } = ctx;

  if (taskType === "feature-planning") {
    await completeFeaturePlanningTask(taskId);

    return;
  }

  try {
    const resolved = await getIssueNumber(taskId);
    const target_repo = resolved.target_repo || targetRepo;
    const issueNumber = await resolveOrCreateIssueNumber(
      resolved.issue_number,
      { taskId, taskType, targetRepo: target_repo, description, output },
      logsRef,
    );

    await recordNoChangeCompletion(ctx, taskUrl, target_repo, issueNumber);
  } catch (err) {
    console.error(
      `[agent-watcher] Failed to complete no-change task ${taskId}: ${errorMessage(err)}`,
    );
  }
}
