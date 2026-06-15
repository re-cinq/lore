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

import { projectFor } from "../../../application/project-boot.js";
import { query } from "../../../data/db.js";
import { buildPrompt, getTaskTypeConfig } from "../../../data/config.js";

const MAX_CONCURRENT_PER_GROUP = 3;

export async function specTaskExecutorJob(): Promise<string> {

  // Find all ready spec-tasks (dependencies satisfied)
  const readyTasks = await query<{
    id: string;
    description: string;
    context_bundle: any;
    target_repo: string;
    task_group_id: string | null;
  }>(
    `SELECT t.id, t.description, t.context_bundle, t.target_repo, t.task_group_id
     FROM pipeline.tasks t
     WHERE t.task_type = 'spec-task'
       AND t.status = 'pending'
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(t.context_bundle->'depends_on') AS dep_id
         WHERE NOT EXISTS (
           SELECT 1 FROM pipeline.tasks d
           WHERE d.target_repo = t.target_repo
             AND d.task_type = 'spec-task'
             AND d.context_bundle->>'spec_task_id' = dep_id
             AND d.context_bundle->>'spec_slug' = t.context_bundle->>'spec_slug'
             AND d.status IN ('completed', 'merged')
         )
       )
     ORDER BY t.context_bundle->>'spec_task_id'`,
  );

  if (readyTasks.length === 0) {
    return "No ready spec-tasks";
  }

  // Count currently running spec-tasks per group to enforce concurrency limit.
  // Also count LoreTask CRs in Running phase to catch tasks the DB hasn't
  // caught up with yet (prevents over-dispatch across executor cycles).
  const runningByGroup = new Map<string, number>();
  const runningRows = await query<{ task_group_id: string; cnt: string }>(
    `SELECT task_group_id, COUNT(*) as cnt
     FROM pipeline.tasks
     WHERE task_type = 'spec-task'
       AND status IN ('running', 'queued')
       AND task_group_id IS NOT NULL
     GROUP BY task_group_id`,
  );
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
    const claimed = await query<{ id: string }>(
      `UPDATE pipeline.tasks
       SET status = 'running', agent_id = 'spec-task-executor', updated_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [task.id],
    );
    if (claimed.length === 0) continue;

    // Record event
    await query(
      `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata)
       VALUES ($1, 'pending', 'running', $2)`,
      [task.id, JSON.stringify({ claimed_by: "spec-task-executor" })],
    ).catch(() => {});

    // Build implementation prompt with spec context
    const specSlug = task.context_bundle?.spec_slug;
    const specTaskId = task.context_bundle?.spec_task_id;
    const filePath = task.context_bundle?.file_path;

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
      await query(
        `UPDATE pipeline.tasks SET status = 'pending', updated_at = now() WHERE id = $1`,
        [task.id],
      );
      console.error(`[spec-task-executor] Failed to create LoreTask for ${task.id}: ${err.message}`);
    }
  }

  return dispatched > 0
    ? `Dispatched ${dispatched}/${readyTasks.length} ready spec-tasks`
    : "No ready spec-tasks";
}
