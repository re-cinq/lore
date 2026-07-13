import {
  taskStore,
  taskQueue,
  settings,
  memoryLifecycle,
} from "../../kernel/queues.js";
import { getPool } from "../../kernel/db.js";
import { projectFor } from "../../composition/project-boot.js";
import { writeEpisodeWithCuration } from "../lib/episode-writer.js";
import {
  parseTasks,
  inferPhaseDependencies,
  syncTasksToDb,
  specSlugFromBranch,
} from "@re-cinq/lore-shared";
import type { Project } from "@re-cinq/lore-shared";
import type { MergeableTask } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";
import { decideDecomposeKick } from "../task/handle-feature-decompose.js";

/**
 * Fallback: when a feature-request task's PR merges and the webhook was missed,
 * read tasks.md from the repo and sync spec-tasks into the pipeline. Goes through
 * the same shared `syncTasksToDb` writer as the webhook path (jobs/github.ts) so
 * both upsert identically — the fallback used to hand-roll an insert-only loop,
 * which diverged (no update-on-existing, different created_by).
 */
async function syncSpecTasksFromMerge(task: {
  id: string;
  target_repo: string;
  target_branch: string | null;
}): Promise<void> {
  const specSlug = specSlugFromBranch(task.target_branch || "");

  if (!specSlug) {
    return;
  }

  // Idempotency: check if spec-tasks already synced (by webhook or previous run)
  if (await taskQueue().hasSpecTasksForSlug(task.target_repo, specSlug)) {
    console.log(`[job] merge-check: spec-tasks already synced for ${specSlug}`);

    return;
  }

  // Read tasks.md from main branch (PR is merged, content is on main)
  const tasksPath = `specs/${specSlug}/tasks.md`;
  const content = await projectFor(task.target_repo).then((p) =>
    p.repo.read(tasksPath),
  );

  if (!content) {
    console.log(`[job] merge-check: no tasks.md at ${tasksPath}`);

    return;
  }

  const withDeps = inferPhaseDependencies(parseTasks(content));
  const taskGroupId = crypto.randomUUID();
  const { created } = await syncTasksToDb(
    getPool(),
    task.target_repo,
    specSlug,
    withDeps,
    taskGroupId,
  );

  console.log(
    `[job] merge-check: synced ${created}/${withDeps.length} spec-tasks for ${specSlug} (group ${taskGroupId})`,
  );
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

      const merged = await projectFor(fullName).then((p) =>
        p.pulls.isMerged(parseInt(prNumber, 10)),
      );

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

      if (await project.pulls.isMerged(task.pr_number)) {
        await handleMergedTask(project, task);
        tasksMerged++;
        console.log(
          `[job] merge-check: task ${task.id} PR #${task.pr_number} merged`,
        );
        continue;
      }

      // Closed-without-merge is a rejection signal.
      if (await project.pulls.isClosed(task.pr_number)) {
        await handleRejectedTask(task);
        tasksClosed++;
        console.log(
          `[job] merge-check: task ${task.id} PR #${task.pr_number} closed (rejected)`,
        );
      }
    } catch (err) {
      console.error(`[job] merge-check: error checking task ${task.id}:`, err);
    }
  }

  return `Checked ${repos.length} repos (${mergedCount} merged), ${tasks.length} tasks (${tasksMerged} merged, ${tasksClosed} rejected)`;
}

/** A merged task: mark merged, close its Issue, capture the outcome episode + stats,
 *  boost contributing memory, promote trust, and kick spec-sync / decompose. */
async function handleMergedTask(
  project: Project,
  task: MergeableTask,
): Promise<void> {
  await taskStore().setStatus(task.id, "merged");
  await taskStore().recordEvent(task.id, "pr-created", "merged", {
    merged_by: "merge-check",
  });

  // Close the GitHub Issue if still open
  if (task.issue_number) {
    try {
      await project.issues.comment(
        task.issue_number,
        `PR #${task.pr_number} merged.`,
      );
      await project.issues.close(task.issue_number, "completed");
    } catch {
      /* best effort */
    }
  }

  // Capture PR outcome as episode for learning
  try {
    const stats = await project.pulls.getStats(task.pr_number);
    const timeToMerge = stats.merged_at
      ? Math.round(
          (new Date(stats.merged_at).getTime() -
            new Date(stats.created_at).getTime()) /
            3600000,
        )
      : null;
    const episode = `Task ${task.task_type} on ${task.target_repo}: PR #${task.pr_number} merged.\nFiles changed: ${stats.files_changed}, +${stats.additions}/-${stats.deletions}\nReview comments: ${stats.comments}\nTime to merge: ${timeToMerge}h\nDescription: ${task.description.substring(0, 200)}`;

    await writeEpisodeWithCuration(
      episode,
      "ci",
      `${task.target_repo}/${task.id}`,
      "merge-check",
      task.id,
    );
    await settings().bumpOutcomeStats(
      task.target_repo,
      stats.files_changed,
      timeToMerge || 0,
    );
  } catch {
    /* outcome capture is best-effort */
  }

  await applyOutcomeFeedback(task.id, "boost");
  await promoteTrust(task.target_repo);

  // For feature-request tasks, auto-sync spec-tasks from tasks.md
  if (task.task_type === "feature-request") {
    try {
      await syncSpecTasksFromMerge(task);
    } catch (err: any) {
      console.error(
        `[job] merge-check: spec-task sync failed for ${task.id}: ${err.message}`,
      );
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
        contextBundle: {
          feature_id: decompose.featureId,
          slug: decompose.slug,
        },
        createdBy: "merge-check",
      });
      console.log(
        `[job] merge-check: kicked feature-decompose for ${decompose.slug ?? decompose.featureId}`,
      );
    } catch (err: any) {
      console.error(
        `[job] merge-check: could not kick decompose for ${task.id}: ${err.message}`,
      );
    }
  }
}

/** A PR closed without merging: mark failed and penalize contributing memory. */
async function handleRejectedTask(task: MergeableTask): Promise<void> {
  await taskStore().setStatus(task.id, "failed", {
    failure_reason: "PR closed without merge",
  });
  await taskStore().recordEvent(task.id, "pr-created", "failed", {
    reason: "pr-rejected",
    detected_by: "merge-check",
  });
  await writeEpisodeWithCuration(
    `Task ${task.task_type} on ${task.target_repo}: PR #${task.pr_number} was closed without merge (rejected).\nDescription: ${task.description.substring(0, 200)}`,
    "ci",
    `${task.target_repo}/${task.id}`,
    "merge-check",
    task.id,
  );
  await applyOutcomeFeedback(task.id, "penalize");
}

/** Boost or penalize a task's contributing facts/memories (PR-outcome feedback).
 *  Best-effort; single source for the previously duplicated boost/penalize blocks. */
async function applyOutcomeFeedback(
  taskId: string,
  action: "boost" | "penalize",
): Promise<void> {
  try {
    const refs = await taskQueue().contextRefs(taskId);

    if (!refs) {
      return;
    }
    const factIds = refs.fact_ids ?? [];
    const memoryIds = refs.memory_ids ?? [];

    if (action === "boost") {
      await memoryLifecycle().boostContributors(factIds, memoryIds);
    } else {
      await memoryLifecycle().penalizeContributors(factIds, memoryIds);
    }
    await memoryLifecycle()
      .writeAuditLog({
        agentId: "merge-check",
        operation: "outcome-feedback",
        metadata: {
          task_id: taskId,
          action,
          fact_count: factIds.length,
          memory_count: memoryIds.length,
        },
      })
      .catch(() => {});
  } catch {
    /* outcome feedback is best-effort */
  }
}

/** Progressive trust: after N successful merges at a level, promote the repo to the
 *  next trust level (docs → tests → implementation → full). Best-effort. */
async function promoteTrust(targetRepo: string): Promise<void> {
  try {
    const repoSettings = await settings().rawSettings(targetRepo);

    if (!repoSettings) {
      return;
    }
    const trust = repoSettings.trust as RepoTrust | undefined;

    if (!trust?.level || trust.level === "full") {
      return;
    }
    const threshold = trust.auto_promote_threshold || 3;
    const count = (trust.successful_tasks || 0) + 1;

    if (count >= threshold) {
      const nextIdx = Math.min(
        TRUST_LEVELS.indexOf(trust.level) + 1,
        TRUST_LEVELS.length - 1,
      );
      const nextLevel = TRUST_LEVELS[nextIdx];

      await settings().updateSettings(targetRepo, {
        ...repoSettings,
        trust: {
          ...trust,
          level: nextLevel,
          successful_tasks: 0,
          promoted_at: new Date().toISOString(),
        },
      });
      console.log(
        `[job] merge-check: ${targetRepo} trust promoted to ${nextLevel}`,
      );
    } else {
      await settings().updateSettings(targetRepo, {
        ...repoSettings,
        trust: { ...trust, successful_tasks: count },
      });
    }
  } catch {
    /* trust promotion is best-effort */
  }
}
