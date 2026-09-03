/** Every minute, picks up ready spec-tasks and dispatches an Agent CR (ADR-031) to implement each, limited to 3 concurrent dispatches per task_group_id. */

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

  // Also counts Agent CRs in Running phase (catching tasks the DB hasn't caught up with) so the per-group cap below can't be starved by a busy sibling group, unlike the former global gate.
  const runningByGroup = new Map<string, number>();
  const runningRows = await pipeline().taskQueue.countRunningSpecTasksByGroup();

  for (const row of runningRows) {
    runningByGroup.set(row.task_group_id, parseInt(row.cnt, 10));
  }

  if (await anthropicCreditsExhausted()) {
    console.warn(
      "[spec-task-executor] API credits exhausted, skipping dispatch",
    );

    return "Skipped: API credits exhausted";
  }

  const implConfig = getTaskTypeConfig("implementation");
  const timeoutMinutes = implConfig?.timeout_minutes || 90;
  const model =
    (implConfig as { model?: string })?.model || "claude-sonnet-4-6";

  let dispatched = 0;

  for (const task of readyTasks) {
    const runningInGroup = task.task_group_id
      ? runningByGroup.get(task.task_group_id) || 0
      : 0;

    if (runningInGroup >= MAX_CONCURRENT_PER_GROUP) {
      continue;
    }

    const claimed = await pipeline().taskQueue.claimSpecTask(task.id);

    if (!claimed) {
      continue;
    }

    await insertEvent(task.id, "pending", "running", {
      claimed_by: "spec-task-executor",
    });

    const cb = (task.context_bundle ?? {}) as {
      spec_slug?: string;
      spec_task_id?: string;
      file_path?: string;
    };
    const specSlug = cb.spec_slug;
    const specTaskId = cb.spec_task_id;
    const filePath = cb.file_path;

    const specRef = specSlug
      ? `\n\nREAD the spec at specs/${specSlug}/spec.md and specs/${specSlug}/data-model.md first for full context.`
      : "";
    const fileRef = filePath ? `\nTarget file: ${filePath}` : "";

    const description = `Implement spec-task ${specTaskId}: ${task.description}${specRef}${fileRef}`;
    const prompt = buildPrompt("implementation", description);

    const slug = specSlug || "spec-task";
    const branchName = `lore/spec-task/${slug}-${(specTaskId || "").toLowerCase()}-${task.id.substring(0, 8)}`;

    try {
      const project = await projectFor(task.target_repo);
      const result = await project.agents.run(task.id, {
        mode: "cluster",
        taskType: "implementation",
        description,
        prompt,
        branch: branchName,
        model,
        timeoutMinutes,
        // extraLabels (spread last) overrides taskType so the CR's metadata label reads "spec-task", not "implementation".
        extraLabels: {
          "lore.re-cinq.com/task-type": "spec-task",
          ...(specSlug
            ? {
                "lore.re-cinq.com/spec-slug":
                  specSlug
                    .replace(/[^a-zA-Z0-9._-]/g, "")
                    .replace(/^-+|-+$/g, "")
                    .substring(0, 63) || "unknown",
              }
            : {}),
        },
      });

      if (result.started) {
        dispatched++;
        bumpGroupCounter(runningByGroup, task.task_group_id);
        console.log(
          `[spec-task-executor] Dispatched ${specTaskId} (${task.id}) → Agent CR`,
        );
      }

      if (!result.started) {
        console.log(
          `[spec-task-executor] Agent CR for ${task.id} already exists, skipping`,
        );
      }
    } catch (err) {
      await setStatus(task.id, "pending");
      console.error(
        `[spec-task-executor] Failed to dispatch Agent for ${task.id}: ${(err as Error).message}`,
      );
    }
  }

  return dispatched > 0
    ? `Dispatched ${dispatched}/${readyTasks.length} ready spec-tasks`
    : "No ready spec-tasks";
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
