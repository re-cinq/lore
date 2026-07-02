/**
 * Spec-task executor job.
 *
 * Picks up ready spec-tasks (all dependencies satisfied, status=pending)
 * and creates LoreTask CRs to implement them via Claude Code in ephemeral pods.
 * Limits concurrent dispatches to 3 per task_group_id to avoid overwhelming
 * the cluster.
 *
 * Runs every minute.
 */

import { anthropicCreditsExhausted } from "@re-cinq/lore-shared/llm/credit-probe.js";
import { projectFor } from "../../composition/project-boot.js";
import { buildPrompt, getTaskTypeConfig } from "../../kernel/config.js";
import { taskQueue } from "../../kernel/queues.js";
import { setStatus, insertEvent } from "./task-helpers.js";

const MAX_CONCURRENT_PER_GROUP = 3;

export async function specTaskExecutorJob(): Promise<string> {

  // Find all ready spec-tasks (dependencies satisfied)
  const readyTasks = await taskQueue().findReadySpecTasks();

  if (readyTasks.length === 0) {
    return "No ready spec-tasks";
  }

  // Count currently running spec-tasks per group to enforce the per-group
  // concurrency limit. Also counts Agent CRs in Running phase to catch tasks the
  // DB hasn't caught up with yet (prevents over-dispatch across executor cycles).
  // The cap is applied per task_group_id in the dispatch loop below — one busy
  // group must not starve another (the former global gate did exactly that).
  const runningByGroup = new Map<string, number>();
  const runningRows = await taskQueue().countRunningSpecTasksByGroup();
  for (const row of runningRows) {
    runningByGroup.set(row.task_group_id, parseInt(row.cnt, 10));
  }

  // Pre-flight billing check: skip the whole batch when the account is out of
  // credits (heuristic + model choice single-sourced in the shared llm module).
  if (await anthropicCreditsExhausted()) {
    console.warn("[spec-task-executor] API credits exhausted, skipping dispatch");
    return "Skipped: API credits exhausted";
  }

  const implConfig = getTaskTypeConfig("implementation");
  const timeoutMinutes = implConfig?.timeout_minutes || 90;
  const model = (implConfig as any)?.model || "claude-sonnet-4-6";

  let dispatched = 0;

  for (const task of readyTasks) {
    // Enforce concurrency limit per task group
    if (task.task_group_id) {
      const running = runningByGroup.get(task.task_group_id) || 0;
      if (running >= MAX_CONCURRENT_PER_GROUP) {
        continue;
      }
    }

    // Atomic claim: set to running only if still pending
    const claimed = await taskQueue().claimSpecTask(task.id);
    if (!claimed) continue;

    // Record event
    await insertEvent(task.id, "pending", "running", {
      claimed_by: "spec-task-executor",
    });

    // Build implementation prompt with spec context
    const cb = (task.context_bundle ?? {}) as {
      spec_slug?: string;
      spec_task_id?: string;
      file_path?: string;
    };
    const specSlug = cb.spec_slug;
    const specTaskId = cb.spec_task_id;
    const filePath = cb.file_path;

    const specRef = specSlug ? `\n\nREAD the spec at specs/${specSlug}/spec.md and specs/${specSlug}/data-model.md first for full context.` : "";
    const fileRef = filePath ? `\nTarget file: ${filePath}` : "";

    const description = `Implement spec-task ${specTaskId}: ${task.description}${specRef}${fileRef}`;
    const prompt = buildPrompt("implementation", description);

    // Branch name
    const slug = specSlug || "spec-task";
    const branchName = `lore/spec-task/${slug}-${(specTaskId || "").toLowerCase()}-${task.id.substring(0, 8)}`;

    const crName = `loretask-${task.id.substring(0, 8)}`;
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
        // The CR metadata label task-type is "spec-task" even though the spec's
        // taskType is "implementation"; extraLabels (spread last) overrides it.
        extraLabels: {
          "lore.re-cinq.com/task-type": "spec-task",
          ...(specSlug
            ? { "lore.re-cinq.com/spec-slug": specSlug.replace(/[^a-zA-Z0-9._-]/g, "").replace(/^-+|-+$/g, "").substring(0, 63) || "unknown" }
            : {}),
        },
      });

      if (result.started) {
        dispatched++;
        // Update concurrency counter
        if (task.task_group_id) {
          runningByGroup.set(
            task.task_group_id,
            (runningByGroup.get(task.task_group_id) || 0) + 1,
          );
        }
        console.log(`[spec-task-executor] Dispatched ${specTaskId} (${task.id}) → LoreTask ${crName}`);
      } else {
        console.log(`[spec-task-executor] LoreTask ${crName} already exists, skipping`);
      }
    } catch (err: any) {
      // Revert to pending on dispatch failure
      await setStatus(task.id, "pending");
      console.error(`[spec-task-executor] Failed to create LoreTask for ${task.id}: ${err.message}`);
    }
  }

  return dispatched > 0
    ? `Dispatched ${dispatched}/${readyTasks.length} ready spec-tasks`
    : "No ready spec-tasks";
}
