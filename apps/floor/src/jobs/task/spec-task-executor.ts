/** Every minute, picks up ready spec-tasks and dispatches an Agent CR (ADR-031) to implement each, limited to 3 concurrent dispatches per task_group_id. */
import type { ReadySpecTask } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";

import { anthropicCreditsExhausted } from "@re-cinq/lore-shared/llm/credit-probe.js";
import { projectFor } from "../../composition/project-boot.js";
import { buildPrompt, getTaskTypeConfig } from "../../kernel/config.js";
import { pipeline } from "../../kernel/queues.js";
import { setStatus, insertEvent } from "./task-helpers.js";

const MAX_CONCURRENT_PER_GROUP = 3;

export async function specTaskExecutorJob(): Promise<string> {
  const readyTasks = await pipeline().taskQueue.findReadySpecTasks();

  if (readyTasks.length === 0) {
    return "No ready spec-tasks";
  }

  if (await anthropicCreditsExhausted()) {
    console.warn(
      "[spec-task-executor] API credits exhausted, skipping dispatch",
    );

    return "Skipped: API credits exhausted";
  }
  const runningByGroup = await runningCountsByGroup();
  const dispatch = agentDispatchDefaults();
  let dispatched = 0;

  for (const task of readyTasks) {
    if (await dispatchSpecTask(task, runningByGroup, dispatch)) {
      dispatched++;
    }
  }

  return dispatched > 0
    ? `Dispatched ${dispatched}/${readyTasks.length} ready spec-tasks`
    : "No ready spec-tasks";
}

/** Counts Agent CRs in Running phase too, catching tasks the DB has not caught up with, so the per-group cap cannot be starved by a busy sibling group the way the former global gate was. */
async function runningCountsByGroup(): Promise<Map<string, number>> {
  const runningByGroup = new Map<string, number>();

  for (const row of await pipeline().taskQueue.countRunningSpecTasksByGroup()) {
    runningByGroup.set(row.task_group_id, parseInt(row.cnt, 10));
  }

  return runningByGroup;
}

interface AgentDispatchDefaults {
  model: string;
  timeoutMinutes: number;
}

function agentDispatchDefaults(): AgentDispatchDefaults {
  const implConfig = getTaskTypeConfig("implementation");

  return {
    model: (implConfig as { model?: string })?.model || "claude-sonnet-4-6",
    timeoutMinutes: implConfig?.timeout_minutes || 90,
  };
}

/** Claim one ready spec-task and dispatch its Agent CR; returns whether a CR actually started. A failure after the claim returns the task to `pending` so the next tick retries it. */
async function dispatchSpecTask(
  task: ReadySpecTask,
  runningByGroup: Map<string, number>,
  defaults: AgentDispatchDefaults,
): Promise<boolean> {
  const runningInGroup = task.task_group_id
    ? runningByGroup.get(task.task_group_id) || 0
    : 0;

  if (runningInGroup >= MAX_CONCURRENT_PER_GROUP) {
    return false;
  }

  if (!(await pipeline().taskQueue.claimSpecTask(task.id))) {
    return false;
  }
  await insertEvent(task.id, "pending", "running", {
    claimed_by: "spec-task-executor",
  });
  const brief = specTaskBrief(task);

  try {
    const project = await projectFor(task.target_repo);
    const result = await project.agents.run(task.id, {
      mode: "cluster",
      taskType: "implementation",
      description: brief.description,
      prompt: buildPrompt("implementation", brief.description),
      branch: brief.branchName,
      model: defaults.model,
      timeoutMinutes: defaults.timeoutMinutes,
      // extraLabels (spread last) overrides taskType so the CR's metadata label reads "spec-task", not "implementation".
      extraLabels: {
        "lore.re-cinq.com/task-type": "spec-task",
        ...(brief.specSlug
          ? { "lore.re-cinq.com/spec-slug": labelValue(brief.specSlug) }
          : {}),
      },
    });

    if (!result.started) {
      console.log(
        `[spec-task-executor] Agent CR for ${task.id} already exists, skipping`,
      );

      return false;
    }
    bumpGroupCounter(runningByGroup, task.task_group_id);
    console.log(
      `[spec-task-executor] Dispatched ${brief.specTaskId} (${task.id}) → Agent CR`,
    );

    return true;
  } catch (err) {
    await setStatus(task.id, "pending");
    console.error(
      `[spec-task-executor] Failed to dispatch Agent for ${task.id}: ${(err as Error).message}`,
    );

    return false;
  }
}

/** What the agent is told to build, and where it builds it. */
function specTaskBrief(task: ReadySpecTask) {
  const cb = (task.context_bundle ?? {}) as {
    spec_slug?: string;
    spec_task_id?: string;
    file_path?: string;
  };
  const specRef = cb.spec_slug
    ? `\n\nREAD the spec at specs/${cb.spec_slug}/spec.md and specs/${cb.spec_slug}/data-model.md first for full context.`
    : "";
  const fileRef = cb.file_path ? `\nTarget file: ${cb.file_path}` : "";
  const slug = cb.spec_slug || "spec-task";

  return {
    specSlug: cb.spec_slug,
    specTaskId: cb.spec_task_id,
    description: `Implement spec-task ${cb.spec_task_id}: ${task.description}${specRef}${fileRef}`,
    branchName: `lore/spec-task/${slug}-${(cb.spec_task_id || "").toLowerCase()}-${task.id.substring(0, 8)}`,
  };
}

/** A Kubernetes label value: alphanumerics, dot, dash and underscore, 63 chars. */
function labelValue(specSlug: string): string {
  return (
    specSlug
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .replace(/^-+|-+$/g, "")
      .substring(0, 63) || "unknown"
  );
}

/** Update the per-group concurrency counter after a successful dispatch. */
function bumpGroupCounter(
  runningByGroup: Map<string, number>,
  taskGroupId: string | null | undefined,
): void {
  if (!taskGroupId) {
    return;
  }
  runningByGroup.set(taskGroupId, (runningByGroup.get(taskGroupId) || 0) + 1);
}
