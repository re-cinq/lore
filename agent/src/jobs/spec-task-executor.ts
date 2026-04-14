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

import { KubeConfig, CustomObjectsApi } from "@kubernetes/client-node";
import { query } from "../db.js";
import { buildPrompt, getTaskTypeConfig } from "../config.js";

const GROUP = "lore.re-cinq.com";
const VERSION = "v1alpha1";
const PLURAL = "loretasks";
const MAX_CONCURRENT_PER_GROUP = 3;

export async function specTaskExecutorJob(): Promise<string> {
  const namespace = process.env.NAMESPACE || "lore-agent";

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

  // Count currently running spec-tasks per group to enforce concurrency limit
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

  const kc = new KubeConfig();
  kc.loadFromCluster();
  const k8sApi = kc.makeApiClient(CustomObjectsApi);

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
    const cr = {
      apiVersion: `${GROUP}/${VERSION}`,
      kind: "LoreTask",
      metadata: {
        name: crName,
        namespace,
        labels: {
          "lore.re-cinq.com/task-id": task.id,
          "lore.re-cinq.com/task-type": "spec-task",
          ...(specSlug ? { "lore.re-cinq.com/spec-slug": specSlug.replace(/[^a-zA-Z0-9._-]/g, "").replace(/^-+|-+$/g, "").substring(0, 63) || "unknown" } : {}),
        },
      },
      spec: {
        taskId: task.id,
        taskType: "implementation",
        description,
        prompt,
        targetRepo: task.target_repo,
        branch: branchName,
        model,
        timeoutMinutes,
      },
    };

    try {
      await k8sApi.createNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace,
        plural: PLURAL,
        body: cr,
      });
      dispatched++;

      // Update concurrency counter
      if (task.task_group_id) {
        runningByGroup.set(
          task.task_group_id,
          (runningByGroup.get(task.task_group_id) || 0) + 1,
        );
      }

      console.log(`[spec-task-executor] Dispatched ${specTaskId} (${task.id}) → LoreTask ${crName}`);
    } catch (err: any) {
      const is409 = err?.code === 409 || String(err?.message).includes("already exists");
      if (is409) {
        console.log(`[spec-task-executor] LoreTask ${crName} already exists, skipping`);
      } else {
        // Revert to pending on dispatch failure
        await query(
          `UPDATE pipeline.tasks SET status = 'pending', updated_at = now() WHERE id = $1`,
          [task.id],
        );
        console.error(`[spec-task-executor] Failed to create LoreTask for ${task.id}: ${err.message}`);
      }
    }
  }

  return dispatched > 0
    ? `Dispatched ${dispatched}/${readyTasks.length} ready spec-tasks`
    : "No ready spec-tasks";
}
