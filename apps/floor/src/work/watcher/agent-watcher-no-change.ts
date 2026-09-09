// Closing out a succeeded run that produced no code changes — the completion routes through the task's GitHub Issue instead of a PR.
import { writeEpisode, errorMessage } from "@re-cinq/lore-shared";
import { projectFor } from "../../outbound/project-boot.js";
import { memoryLifecycle, pipeline, taskStore } from "../../outbound/queues.js";
import { generateArtifactCopy } from "../../outbound/artifact-copy.js";
import { taskPageUrl } from "../../domain/agent-watcher-logic.js";
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

/** The agent's own output is the issue body when it produced any; the generated copy is only the fallback. */
async function openNoChangeIssue(
  target: NoChangeIssueTarget,
  logsRef: string,
): Promise<{ number: number; url?: string }> {
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

  return await (
    await projectFor(target.targetRepo)
  ).issues.create(copy.title, body, ["lore-managed", target.taskType]);
}

/** Opens the no-changes Issue; best-effort — a failure here just leaves `issue_number` null. */
async function createNoChangeIssue(
  target: NoChangeIssueTarget,
  logsRef: string,
): Promise<number | null> {
  try {
    const issue = await openNoChangeIssue(target, logsRef);

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

/** A no-change run is still worth remembering: the episode records that this task type asked for work already done, which is what stops the same request being filed again. */
function recordNoChangeEpisode(ctx: AgentContext, targetRepo: string): void {
  const { taskId, taskType, description, output } = ctx;

  writeEpisode(
    { memory: memoryLifecycle() },
    {
      content: `Task ${taskType} on ${targetRepo} completed (no changes)\nDescription: ${description.substring(0, 500)}\nOutput: ${output.substring(0, 2000)}`,
      source: "ci",
      ref: `${targetRepo}/${taskId}`,
    },
  ).catch(() => {});
}

/** The notification only fires when there is an Issue to point at. */
async function announceNoChange(
  ctx: AgentContext,
  targetRepo: string,
  issueNumber: number | null,
): Promise<void> {
  if (issueNumber) {
    await notifyTaskUpdate(
      ctx.taskId,
      targetRepo,
      "completed",
      `https://github.com/${targetRepo}/issues/${issueNumber}`,
    );
  }
  recordNoChangeEpisode(ctx, targetRepo);
  console.log(
    `[agent-watcher] Task ${ctx.taskId} completed → issue #${issueNumber || "none"}`,
  );
}

async function recordNoChangeCompletion(
  ctx: AgentContext,
  taskUrl: ReturnType<typeof taskPageUrl>,
  targetRepo: string,
  issueNumber: number | null,
): Promise<void> {
  const { taskId } = ctx;

  await taskStore().setStatus(taskId, "completed", { log_url: taskUrl });
  await taskStore().recordEvent(taskId, "running", "completed", {
    no_changes: true,
    issue_number: issueNumber,
  });

  await announceNoChange(ctx, targetRepo, issueNumber);
}

/** The Issue the task already has wins over its context's repo — a task re-homed at dispatch keeps reporting into the thread a human is already reading. */
async function settleNoChangeIssue(
  ctx: AgentContext,
  taskUrl: ReturnType<typeof taskPageUrl>,
  logsRef: string,
): Promise<void> {
  const { taskId, taskType, description, output } = ctx;
  const resolved = await getIssueNumber(taskId);
  const targetRepo = resolved.target_repo || ctx.targetRepo;
  const issueNumber = await resolveOrCreateIssueNumber(
    resolved.issue_number,
    { taskId, taskType, targetRepo, description, output },
    logsRef,
  );

  await recordNoChangeCompletion(ctx, taskUrl, targetRepo, issueNumber);
}

/** Closes out a succeeded no-changes task, routing the result through its GitHub Issue. */
export async function completeNoChangeTask(
  ctx: AgentContext,
  taskUrl: ReturnType<typeof taskPageUrl>,
  logsRef: string,
): Promise<void> {
  if (ctx.taskType === "feature-planning") {
    await completeFeaturePlanningTask(ctx.taskId);

    return;
  }

  try {
    await settleNoChangeIssue(ctx, taskUrl, logsRef);
  } catch (err) {
    console.error(
      `[agent-watcher] Failed to complete no-change task ${ctx.taskId}: ${errorMessage(err)}`,
    );
  }
}
