import { taskStore, taskQueue, settings, memoryLifecycle } from "../../kernel/queues.js";
import { getPool } from "../../kernel/db.js";
import { projectFor } from "../../composition/project-boot.js";
import { writeEpisodeWithCuration } from "../memory/episode-writer.js";
import { parseTasks, inferPhaseDependencies, syncTasksToDb, specSlugFromBranch } from "@re-cinq/lore-shared";
import { decideDecomposeKick } from "../task/handle-feature-decompose.js";

/**
 * Fallback: when a feature-request task's PR merges and the webhook was missed,
 * read tasks.md from the repo and sync spec-tasks into the pipeline. Goes through
 * the same shared `syncTasksToDb` writer as the webhook path (jobs/github.ts) so
 * both upsert identically — the fallback used to hand-roll an insert-only loop,
 * which diverged (no update-on-existing, different created_by).
 */
async function syncSpecTasksFromMerge(task: { id: string; target_repo: string; target_branch: string | null }): Promise<void> {
  const specSlug = specSlugFromBranch(task.target_branch || "");
  if (!specSlug) return;

  // Idempotency: check if spec-tasks already synced (by webhook or previous run)
  if (await taskQueue().hasSpecTasksForSlug(task.target_repo, specSlug)) {
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

  const withDeps = inferPhaseDependencies(parseTasks(content));
  const taskGroupId = crypto.randomUUID();
  const { created } = await syncTasksToDb(getPool(), task.target_repo, specSlug, withDeps, taskGroupId);

  console.log(`[job] merge-check: synced ${created}/${withDeps.length} spec-tasks for ${specSlug} (group ${taskGroupId})`);
}

const TRUST_LEVELS = ["docs", "tests", "implementation", "full"];

interface RepoTrust {
  level?: string;
  auto_promote_threshold?: number;
  successful_tasks?: number;
  [key: string]: unknown;
}

export async function mergeCheckJob(): Promise<string> {
  const repos = await settings().pendingOnboardingRepos();

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
        await settings().markOnboardingMergedById(repo.id);
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
  const tasks = await taskQueue().mergeableTasks();

  let tasksMerged = 0;
  let tasksClosed = 0;
  for (const task of tasks) {
    try {
      const project = await projectFor(task.target_repo);
      const merged = await project.pulls.isMerged(task.pr_number);
      if (merged) {
        await taskStore().setStatus(task.id, "merged");
        await taskStore().recordEvent(task.id, "pr-created", "merged", { merged_by: "merge-check" });
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
          await settings().bumpOutcomeStats(task.target_repo, stats.files_changed, timeToMerge || 0);
        } catch { /* outcome capture is best-effort */ }
        // Outcome feedback: boost contributing facts/memories
        try {
          const refs = await taskQueue().contextRefs(task.id);
          if (refs) {
            await memoryLifecycle().boostContributors(refs.fact_ids ?? [], refs.memory_ids ?? []);
            await memoryLifecycle().writeAuditLog({
              agentId: "merge-check",
              operation: "outcome-feedback",
              metadata: { task_id: task.id, action: "boost", fact_count: refs.fact_ids?.length || 0, memory_count: refs.memory_ids?.length || 0 },
            }).catch(() => {});
          }
        } catch { /* outcome feedback is best-effort */ }
        // Progressive trust: auto-promote after N successful merges
        try {
          const repoSettings = await settings().rawSettings(task.target_repo);
          if (repoSettings) {
            const trust = repoSettings.trust as RepoTrust | undefined;
            if (trust?.level && trust.level !== "full") {
              const threshold = trust.auto_promote_threshold || 3;
              const count = (trust.successful_tasks || 0) + 1;
              if (count >= threshold) {
                const nextIdx = Math.min(TRUST_LEVELS.indexOf(trust.level) + 1, TRUST_LEVELS.length - 1);
                const nextLevel = TRUST_LEVELS[nextIdx];
                await settings().updateSettings(task.target_repo, {
                  ...repoSettings,
                  trust: { ...trust, level: nextLevel, successful_tasks: 0, promoted_at: new Date().toISOString() },
                });
                console.log(`[job] merge-check: ${task.target_repo} trust promoted to ${nextLevel}`);
              } else {
                await settings().updateSettings(task.target_repo, {
                  ...repoSettings,
                  trust: { ...trust, successful_tasks: count },
                });
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
            await taskQueue().insertTask({
              description: `Decompose feature: ${decompose.slug ?? decompose.featureId}`,
              taskType: "feature-decompose",
              targetRepo: task.target_repo,
              status: "pending",
              contextBundle: { feature_id: decompose.featureId, slug: decompose.slug },
              createdBy: "merge-check",
            });
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
        await taskStore().setStatus(task.id, "failed", { failure_reason: "PR closed without merge" });
        await taskStore().recordEvent(task.id, "pr-created", "failed", { reason: "pr-rejected", detected_by: "merge-check" });
        await writeEpisodeWithCuration(
          `Task ${task.task_type} on ${task.target_repo}: PR #${task.pr_number} was closed without merge (rejected).\nDescription: ${task.description.substring(0, 200)}`,
          "ci", `${task.target_repo}/${task.id}`, "merge-check", task.id,
        );
        // Outcome feedback: penalize contributing facts/memories on rejection
        try {
          const refs = await taskQueue().contextRefs(task.id);
          if (refs) {
            await memoryLifecycle().penalizeContributors(refs.fact_ids ?? [], refs.memory_ids ?? []);
            await memoryLifecycle().writeAuditLog({
              agentId: "merge-check",
              operation: "outcome-feedback",
              metadata: { task_id: task.id, action: "penalize", fact_count: refs.fact_ids?.length || 0, memory_count: refs.memory_ids?.length || 0 },
            }).catch(() => {});
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
