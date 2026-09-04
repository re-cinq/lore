// A failed CR's terminal handling: record the failure against the task/issue, or requeue it when the failure is transient infra rather than the agent's own work.
import type { PipelineTask } from "@re-cinq/lore-shared";
import { pipeline, memoryLifecycle, taskStore } from "../../kernel/queues.js";
import { writeEpisodeWithCuration } from "@re-cinq/lore-shared";
import {
  isTransientInfraFailure,
  MAX_INFRA_RETRIES,
} from "@re-cinq/lore-shared/k8s-pod-failure.js";
import { taskPageUrl } from "./agent-watcher-logic.js";
import {
  type AgentContext,
  commentFailureOnIssue,
  notifyTaskUpdate,
} from "./agent-watcher-notify.js";

/** Deciding whether a failed run is worth a bounded automatic retry, not just an escalation. */
function shouldRequeueTransientInfra(
  reason: string,
  infraRetries: number,
): boolean {
  return isTransientInfraFailure(reason) && infraRetries < MAX_INFRA_RETRIES;
}

async function recordTaskFailure(
  ctx: AgentContext,
  failedTask: PipelineTask,
  { reason, taskUrl }: { reason: string; taskUrl: string | undefined },
): Promise<void> {
  const { taskId, taskType, targetRepo, description, output } = ctx;

  await taskStore().setStatus(taskId, "failed", {
    failure_reason: reason,
    log_url: taskUrl,
  });
  await taskStore().recordEvent(taskId, "running", "failed", {
    error: reason,
  });
  await commentFailureOnIssue(
    failedTask.target_repo,
    failedTask.issue_number ?? null,
    reason,
  );
  await notifyTaskUpdate(
    taskId,
    failedTask.target_repo,
    "failed",
    `${taskType}: ${reason.substring(0, 200)}`,
  );
  writeEpisodeWithCuration(
    { memory: memoryLifecycle() },
    {
      content: `Task failed on ${targetRepo}: ${taskType}\n\nDescription: ${description}\n\nFailure: ${reason}\n\nOutput:\n${output.slice(-2000)}`,
      source: "ci",
      ref: `${targetRepo}/${taskId}`,
      agentId: "agent-watcher",
      taskId,
    },
  ).catch(() => {});
  console.log(`[agent-watcher] Task ${taskId} failed: ${reason}`);
}

/** Bounded re-queue of a transient-infra failure, carrying the retry count forward and keeping the Issue thread. */
interface TransientInfraFailure {
  reason: string;
  taskUrl: string | undefined;
  infraRetries: number;
}

async function requeueTransientInfraFailure(
  ctx: AgentContext,
  failedTask: PipelineTask,
  { reason, taskUrl, infraRetries }: TransientInfraFailure,
): Promise<void> {
  const { taskId, taskType, targetRepo, description } = ctx;
  const bundle = failedTask.context_bundle ?? {};

  await taskStore().setStatus(taskId, "failed", {
    failure_reason: reason,
    log_url: taskUrl,
  });
  await taskStore().recordEvent(taskId, "running", "failed", {
    error: reason,
    transient_infra: true,
    infra_retry: infraRetries + 1,
  });
  const requeuedId = await pipeline().taskQueue.insertTask({
    description,
    taskType,
    status: "pending",
    targetRepo,
    createdBy: failedTask.created_by,
    contextBundle: {
      ...bundle,
      infra_retry_count: infraRetries + 1,
      retry_of: taskId,
    },
  });

  if (requeuedId && failedTask.issue_number != null) {
    await pipeline().taskQueue.setColumns(requeuedId, {
      issue_number: failedTask.issue_number,
    });
  }
  console.log(
    `[agent-watcher] Task ${taskId} transient infra failure (${reason}) — re-queued ${infraRetries + 1}/${MAX_INFRA_RETRIES}`,
  );
}

/** Failed CR: record the failure, with a bounded transient-infra re-queue. */
export async function handleFailure(
  ctx: AgentContext,
  reason: string,
): Promise<void> {
  const failedTask = await taskStore().getById(ctx.taskId);

  if (!failedTask || failedTask.status !== "running") {
    return;
  }

  const bundle = failedTask.context_bundle ?? {};
  const infraRetries = Number(bundle.infra_retry_count ?? 0);
  const taskUrl = taskPageUrl(ctx.taskId, process.env.LORE_UI_URL);

  if (shouldRequeueTransientInfra(reason, infraRetries)) {
    await requeueTransientInfraFailure(ctx, failedTask, {
      reason,
      taskUrl,
      infraRetries,
    });

    return;
  }

  await recordTaskFailure(ctx, failedTask, { reason, taskUrl });
}
