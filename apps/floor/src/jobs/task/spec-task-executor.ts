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

  // Count currently running spec-tasks per group to enforce concurrency limit.
  // Also count LoreTask CRs in Running phase to catch tasks the DB hasn't
  // caught up with yet (prevents over-dispatch across executor cycles).
  const runningByGroup = new Map<string, number>();
  const runningRows = await taskQueue().countRunningSpecTasksByGroup();
  for (const row of runningRows) {
    runningByGroup.set(row.task_group_id, parseInt(row.cnt, 10));
  }

  // Hard limit: skip dispatch entirely if too many tasks are already running
  const totalRunning = [...runningByGroup.values()].reduce((a, b) => a + b, 0);
  if (totalRunning >= MAX_CONCURRENT_PER_GROUP) {
    return `Waiting: ${totalRunning} spec-tasks already running (limit ${MAX_CONCURRENT_PER_GROUP})`;
  }

  // Pre-flight: check Anthropic API is reachable and credits are available
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      if (resp.status === 429 || resp.status === 403) {
        const body = await resp.text().catch(() => "");
        if (body.includes("credit") || body.includes("balance") || body.includes("billing")) {
          console.warn("[spec-task-executor] API credits exhausted, skipping dispatch");
          return "Skipped: API credits exhausted";
        }
      }
    } catch { /* network error — proceed and let individual tasks handle it */ }
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
