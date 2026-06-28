import { query } from "../kernel/db.js";
import { projectFor } from "../composition/project-boot.js";
import { writeEpisodeWithCuration } from "../memory/episode-writer.js";
import { parseTasks, inferPhaseDependencies } from "@re-cinq/lore-shared";
import { decideDecomposeKick } from "../task/handle-feature-decompose.js";

/**
 * Fallback: when a feature-request task's PR merges and the webhook was missed,
 * read tasks.md from the repo and sync spec-tasks into the pipeline.
 */
async function syncSpecTasksFromMerge(task: { id: string; target_repo: string; target_branch: string | null }): Promise<void> {
  const branch = task.target_branch || "";
  if (!branch.startsWith("lore/feature-request/")) return;

  // Extract spec slug from branch: lore/feature-request/{slug}-{taskId8}
  const branchSuffix = branch.replace("lore/feature-request/", "");
  const specSlug = branchSuffix.replace(/-[a-f0-9]{8}$/, "");
  if (!specSlug) return;

  // Idempotency: check if spec-tasks already synced (by webhook or previous run)
  const existing = await query<{ id: string }>(
    `SELECT id FROM pipeline.tasks
     WHERE task_type = 'spec-task'
       AND target_repo = $1
       AND context_bundle->>'spec_slug' = $2
     LIMIT 1`,
    [task.target_repo, specSlug],
  );
  if (existing.length > 0) {
    console.log(`[job] merge-check: spec-tasks already synced for ${specSlug}`);
    return;
  }

  // Read tasks.md from main branch (PR is merged, content is on main)
  const tasksPath = `specs/${specSlug}/tasks.md`;
  const content = await projectFor(task.target_repo).then((p) => p.repo.read(tasksPath));
  if (!content) {
    console.log(`[job] merge-check: no tasks.md at ${tasksPath}`);
    return;
  }

  // Parse and infer dependencies
  const parsed = parseTasks(content);
  const withDeps = inferPhaseDependencies(parsed);

  // Sync to DB
  const taskGroupId = crypto.randomUUID();
  let created = 0;
  for (const t of withDeps) {
    const title = `${t.specTaskId}: ${t.description}`;
    const metadata = {
      spec_task_id: t.specTaskId,
      depends_on: t.dependsOn,
      spec_slug: specSlug,
      parallelizable: t.parallelizable,
      phase: t.phase,
      file_path: t.filePath,
    };
    const status = t.completed ? "completed" : "pending";
    const result = await query<{ id: string }>(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, status, context_bundle, created_by, task_group_id)
       VALUES ($1, 'spec-task', $2, $3, $4, 'merge-check', $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [title, task.target_repo, status, JSON.stringify(metadata), taskGroupId],
    );
    if (result.length > 0) created++;
  }

  console.log(`[job] merge-check: synced ${created}/${withDeps.length} spec-tasks for ${specSlug} (group ${taskGroupId})`);
}

interface PendingRepo {
  id: string;
  full_name: string;
  onboarding_pr_url: string;
}

export async function mergeCheckJob(): Promise<string> {
  const repos = await query<PendingRepo>(
    `SELECT id, full_name, onboarding_pr_url
     FROM lore.repos
     WHERE onboarding_pr_merged = false
       AND onboarding_pr_url IS NOT NULL`,
  );

  if (repos.length === 0) {
    console.log("[job] merge-check: no pending repos");
  }

  let mergedCount = 0;

  for (const repo of repos) {
    try {
      // Extract owner/repo and PR number from URL
      // e.g. https://github.com/org/repo/pull/42
      const match = repo.onboarding_pr_url.match(
        /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
      );
      if (!match) {
        console.log(
          `[job] merge-check: invalid PR URL for ${repo.full_name}: ${repo.onboarding_pr_url}`,
        );
        continue;
      }

      const [, owner, repoName, prNumber] = match;
      const fullName = `${owner}/${repoName}`;

      const merged = await projectFor(fullName).then((p) => p.pulls.isMerged(parseInt(prNumber, 10)));

      if (merged) {
        await query(
          `UPDATE lore.repos
           SET onboarding_pr_merged = true, last_ingested_at = now()
           WHERE id = $1`,
          [repo.id],
        );
        mergedCount++;
        console.log(`[job] merge-check: ${repo.full_name} PR merged`);
      }
    } catch (err) {
      console.error(
        `[job] merge-check: error checking ${repo.full_name}:`,
        err,
      );
    }
  }

  // Also check pipeline tasks with PRs that might have been merged
  const tasks = await query<{ id: string; target_repo: string; target_branch: string | null; pr_url: string; pr_number: number; issue_number: number | null; task_type: string; description: string; created_at: string; context_bundle: { feature_id?: string; slug?: string } | null }>(
    `SELECT id, target_repo, target_branch, pr_url, pr_number, issue_number, task_type, description, created_at, context_bundle
     FROM pipeline.tasks
     WHERE status IN ('pr-created', 'review')
       AND pr_number IS NOT NULL
       AND pr_url IS NOT NULL`,
  );

  let tasksMerged = 0;
  let tasksClosed = 0;
  for (const task of tasks) {
    try {
      const project = await projectFor(task.target_repo);
      const merged = await project.pulls.isMerged(task.pr_number);
      if (merged) {
        await query(
          `UPDATE pipeline.tasks SET status = 'merged', updated_at = now() WHERE id = $1`,
          [task.id],
        );
        await query(
          `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'pr-created', 'merged', $2)`,
          [task.id, JSON.stringify({ merged_by: "merge-check" })],
        );
        // Close the GitHub Issue if still open
        if (task.issue_number) {
          try {
            await project.issues.comment(task.issue_number, `PR #${task.pr_number} merged.`);
            await project.issues.close(task.issue_number, "completed");
          } catch { /* best effort */ }
        }
        // Capture PR outcome as episode for learning
        try {
          const stats = await project.pulls.getStats(task.pr_number);
          const timeToMerge = stats.merged_at
            ? Math.round((new Date(stats.merged_at).getTime() - new Date(stats.created_at).getTime()) / 3600000)
            : null;
          const episode = `Task ${task.task_type} on ${task.target_repo}: PR #${task.pr_number} merged.\nFiles changed: ${stats.files_changed}, +${stats.additions}/-${stats.deletions}\nReview comments: ${stats.comments}\nTime to merge: ${timeToMerge}h\nDescription: ${task.description.substring(0, 200)}`;
          await writeEpisodeWithCuration(episode, "ci", `${task.target_repo}/${task.id}`, "merge-check", task.id);
          // Update repo outcome_stats
          await query(
            `UPDATE lore.repos SET outcome_stats = jsonb_set(
               jsonb_set(
                 jsonb_set(COALESCE(outcome_stats, '{}'), '{merged_count}', to_jsonb(COALESCE((outcome_stats->>'merged_count')::int, 0) + 1)),
                 '{total_files_changed}', to_jsonb(COALESCE((outcome_stats->>'total_files_changed')::int, 0) + $2)),
               '{total_hours_to_merge}', to_jsonb(COALESCE((outcome_stats->>'total_hours_to_merge')::int, 0) + $3))
             WHERE full_name = $1`,
            [task.target_repo, stats.files_changed, timeToMerge || 0],
          );
        } catch { /* outcome capture is best-effort */ }
        // Outcome feedback: boost contributing facts/memories
        try {
          const taskRows = await query<{ context_refs: any }>(
            `SELECT context_refs FROM pipeline.tasks WHERE id = $1`, [task.id],
          );
          const refs = taskRows[0]?.context_refs;
          if (refs) {
            if (refs.fact_ids?.length > 0) {
              await query(
                `UPDATE memory.facts SET half_life_days = LEAST(COALESCE(half_life_days, 30) + 5, 365) WHERE id = ANY($1::uuid[])`,
                [refs.fact_ids],
              );
            }
            if (refs.memory_ids?.length > 0) {
              await query(
                `UPDATE memory.memories SET half_life_days = LEAST(COALESCE(half_life_days, 60) + 5, 365) WHERE id = ANY($1::uuid[])`,
                [refs.memory_ids],
              );
            }
            await query(
              `INSERT INTO memory.audit_log (agent_id, operation, metadata) VALUES ('merge-check', 'outcome-feedback', $1)`,
              [JSON.stringify({ task_id: task.id, action: 'boost', fact_count: refs.fact_ids?.length || 0, memory_count: refs.memory_ids?.length || 0 })],
            ).catch(() => {});
          }
        } catch { /* outcome feedback is best-effort */ }
        // Progressive trust: auto-promote after N successful merges
        try {
          const trustLevels = ["docs", "tests", "implementation", "full"];
          const repoRows = await query<{ settings: any }>(
            `SELECT settings FROM lore.repos WHERE full_name = $1`, [task.target_repo],
          );
          if (repoRows.length > 0) {
            const settings = repoRows[0].settings || {};
            const trust = settings.trust;
            if (trust?.level && trust.level !== "full") {
              const threshold = trust.auto_promote_threshold || 3;
              const count = (trust.successful_tasks || 0) + 1;
              if (count >= threshold) {
                const nextIdx = Math.min(trustLevels.indexOf(trust.level) + 1, trustLevels.length - 1);
                const nextLevel = trustLevels[nextIdx];
                await query(
                  `UPDATE lore.repos SET settings = jsonb_set(settings, '{trust}', $2::jsonb) WHERE full_name = $1`,
                  [task.target_repo, JSON.stringify({ ...trust, level: nextLevel, successful_tasks: 0, promoted_at: new Date().toISOString() })],
                );
                console.log(`[job] merge-check: ${task.target_repo} trust promoted to ${nextLevel}`);
              } else {
                await query(
                  `UPDATE lore.repos SET settings = jsonb_set(settings, '{trust,successful_tasks}', to_jsonb($2)) WHERE full_name = $1`,
                  [task.target_repo, count],
                );
              }
            }
          }
        } catch { /* trust promotion is best-effort */ }
        // For feature-request tasks, auto-sync spec-tasks from tasks.md
        if (task.task_type === "feature-request") {
          try {
            await syncSpecTasksFromMerge(task);
          } catch (err: any) {
            console.error(`[job] merge-check: spec-task sync failed for ${task.id}: ${err.message}`);
          }
        }
        // When a finalized feature's spec PR merges, decompose it into stories +
        // spec-tasks (ADR-029). The decompose handler is idempotent on the slug.
        const decompose = decideDecomposeKick(task);
        if (decompose.kick) {
          try {
            await query(
              `INSERT INTO pipeline.tasks (description, task_type, target_repo, status, context_bundle, created_by)
               VALUES ($1, 'feature-decompose', $2, 'pending', $3, 'merge-check')`,
              [
                `Decompose feature: ${decompose.slug ?? decompose.featureId}`,
                task.target_repo,
                JSON.stringify({ feature_id: decompose.featureId, slug: decompose.slug }),
              ],
            );
            console.log(`[job] merge-check: kicked feature-decompose for ${decompose.slug ?? decompose.featureId}`);
          } catch (err: any) {
            console.error(`[job] merge-check: could not kick decompose for ${task.id}: ${err.message}`);
          }
        }
        tasksMerged++;
        console.log(`[job] merge-check: task ${task.id} PR #${task.pr_number} merged`);
        continue;
      }

      // Check for closed-without-merge (PR rejection)
      const closed = await projectFor(task.target_repo).then((p) => p.pulls.isClosed(task.pr_number));
      if (closed) {
        await query(`UPDATE pipeline.tasks SET status = 'failed', failure_reason = 'PR closed without merge' WHERE id = $1`, [task.id]);
        await query(
          `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'pr-created', 'failed', $2)`,
          [task.id, JSON.stringify({ reason: "pr-rejected", detected_by: "merge-check" })],
        );
        await writeEpisodeWithCuration(
          `Task ${task.task_type} on ${task.target_repo}: PR #${task.pr_number} was closed without merge (rejected).\nDescription: ${task.description.substring(0, 200)}`,
          "ci", `${task.target_repo}/${task.id}`, "merge-check", task.id,
        );
        // Outcome feedback: penalize contributing facts/memories on rejection
        try {
          const taskRows = await query<{ context_refs: any }>(
            `SELECT context_refs FROM pipeline.tasks WHERE id = $1`, [task.id],
          );
          const refs = taskRows[0]?.context_refs;
          if (refs) {
            if (refs.fact_ids?.length > 0) {
              await query(
                `UPDATE memory.facts SET half_life_days = GREATEST(7, COALESCE(half_life_days, 30) - 3) WHERE id = ANY($1::uuid[])`,
                [refs.fact_ids],
              );
            }
            if (refs.memory_ids?.length > 0) {
              await query(
                `UPDATE memory.memories SET half_life_days = GREATEST(7, COALESCE(half_life_days, 60) - 3) WHERE id = ANY($1::uuid[])`,
                [refs.memory_ids],
              );
            }
            await query(
              `INSERT INTO memory.audit_log (agent_id, operation, metadata) VALUES ('merge-check', 'outcome-feedback', $1)`,
              [JSON.stringify({ task_id: task.id, action: 'penalize', fact_count: refs.fact_ids?.length || 0, memory_count: refs.memory_ids?.length || 0 })],
            ).catch(() => {});
          }
        } catch { /* best-effort */ }
        tasksClosed++;
        console.log(`[job] merge-check: task ${task.id} PR #${task.pr_number} closed (rejected)`);
      }
    } catch (err) {
      console.error(`[job] merge-check: error checking task ${task.id}:`, err);
    }
  }

  return `Checked ${repos.length} repos (${mergedCount} merged), ${tasks.length} tasks (${tasksMerged} merged, ${tasksClosed} rejected)`;
}
