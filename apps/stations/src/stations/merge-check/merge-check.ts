// Moved from the Floor (ADR-024): once-a-minute sweep over merged/closed PRs.

import {
  pipeline,
  taskStore,
  settings,
  memoryLifecycle,
} from "../../kernel/queues.js";
import { getPool } from "@re-cinq/lore-shared/db/pg-pool.js";
import { startMergeLine } from "./start-merge-line.js";
import {} from "@re-cinq/lore-shared/project/assembly-runs/decompose-resume.js";
import { projectFor } from "../../kernel/project-boot.js";
import { writeEpisodeWithCuration } from "@re-cinq/lore-shared";
import { nextTrust } from "../lib/trust-ladder.js";
import {
  parseTasks,
  inferPhaseDependencies,
  syncTasksToDb,
  specSlugFromBranch,
  openSpecStatusFlipPr,
} from "@re-cinq/lore-shared";
import type { Project, StatusFlipResult } from "@re-cinq/lore-shared";
import type { MergeableTask } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";

/** Fallback: sync spec-tasks when feature-request PR merges but webhook missed. */
export async function syncSpecTasksFromMerge(task: {
  id: string;
  target_repo: string;
  target_branch: string | null;
}): Promise<void> {
  const specSlug = specSlugFromBranch(task.target_branch || "");

  if (!specSlug) {
    return;
  }

  // Idempotency: check if spec-tasks already synced (by webhook or previous run)
  if (
    await pipeline().taskQueue.hasSpecTasksForSlug(task.target_repo, specSlug)
  ) {
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
    { repo: task.target_repo, specSlug, taskGroupId },
    withDeps,
  );

  console.log(
    `[job] merge-check: synced ${created}/${withDeps.length} spec-tasks for ${specSlug} (group ${taskGroupId})`,
  );
}

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
      // Extract owner/repo and PR number from URL: https://github.com/org/repo/pull/42
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
      const number = parseInt(prNumber, 10);
      const project = await projectFor(fullName);

      if (await project.pulls.isMerged(number)) {
        await settings().markOnboardingMergedById(repo.id);
        mergedCount++;
        console.log(`[job] merge-check: ${repo.full_name} PR merged`);
        continue;
      }

      // Closed without merging: clear onboarding URL to allow resubmission (#968).
      if (await project.pulls.isClosed(number)) {
        await settings().clearOnboardingPrUrl(repo.id);
        console.log(
          `[job] merge-check: ${repo.full_name} onboarding PR closed unmerged — cleared`,
        );
      }
    } catch (err) {
      console.error(
        `[job] merge-check: error checking ${repo.full_name}:`,
        err,
      );
    }
  }

  // Also check pipeline tasks with PRs that might have been merged
  const tasks = await pipeline().taskQueue.mergeableTasks();

  let tasksMerged = 0;
  let tasksClosed = 0;

  for (const task of tasks) {
    try {
      const project = await projectFor(task.target_repo);

      if (await project.pulls.isMerged(task.pr_number)) {
        // The line does the work; nine steps expose failures that route forward.
        await startMergeLine(task, {
          findOpenBySubject: (repo, key) =>
            pipeline().assemblyRuns.findOpenBySubject(repo, key),
          countBySubject: (repo, key) =>
            pipeline().assemblyRuns.countBySubject(repo, key),
          start: (input) => pipeline().assemblyRuns.start(input),
        });
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

/** Decide whether merged task completes its feature's task group (pure). */
export function decideSpecStatusFlip(
  task: Pick<MergeableTask, "task_type" | "task_group_id" | "context_bundle">,
  remainingInGroup: number,
): { featureId: string } | null {
  if (task.task_type !== "spec-task" || !task.task_group_id) {
    return null;
  }

  if (remainingInGroup > 0) {
    return null;
  }
  const featureId = task.context_bundle?.feature_id;

  return featureId ? { featureId } : null;
}

/** Keep features table in sync with spec status (FR1). */
export function decideFeatureImplemented(result: StatusFlipResult): boolean {
  return (
    result.status === "shipped" &&
    (!result.skipped || result.reason === "already-current")
  );
}

/** spec-status-upkeep FR1: flip spec status on group merge (ADR-016). */
export async function maybeFlipSpecStatus(
  project: Project,
  task: MergeableTask,
): Promise<void> {
  const remaining = task.task_group_id
    ? await pipeline().taskQueue.countUnmergedInGroup(task.task_group_id)
    : 0;
  const decision = decideSpecStatusFlip(task, remaining);

  if (!decision) {
    return;
  }

  const feature = await project.features.get(decision.featureId);

  if (!feature) {
    return;
  }
  const specPath = feature.spec_path ?? `specs/${feature.slug}/spec.md`;
  const result = await openSpecStatusFlipPr(project, specPath, {
    evidence: `Completion: every task in group \`${task.task_group_id}\` is merged (last: PR #${task.pr_number}).`,
  });

  if (decideFeatureImplemented(result)) {
    await project.features.transitionStatus(decision.featureId, "implemented");
    console.log(
      `[job] merge-check: spec-status-upkeep marked ${specPath} implemented ` +
        `(${result.skipped ? "already current" : result.prUrl})`,
    );

    return;
  }
  console.warn(
    `[job] merge-check: spec-status-upkeep did not mark ${specPath} shipped ` +
      `(status=${result.status ?? "unreadable"}, reason=${result.reason ?? "flipped"}` +
      `${result.prUrl ? `, pr=${result.prUrl}` : ""}); ` +
      `feature ${decision.featureId} left for human reconcile`,
  );
}

/** A merged task: mark merged, close Issue, boost memory, promote trust. */

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
    { memory: memoryLifecycle() },
    {
      content: `Task ${task.task_type} on ${task.target_repo}: PR #${task.pr_number} was closed without merge (rejected).\nDescription: ${task.description.substring(0, 200)}`,
      source: "ci",
      ref: `${task.target_repo}/${task.id}`,
      agentId: "merge-check",
      taskId: task.id,
    },
  );
  await applyOutcomeFeedback(task.id, "penalize");
}

/** Boost or penalize task facts/memories by PR outcome. */
export async function applyOutcomeFeedback(
  taskId: string,
  action: "boost" | "penalize",
): Promise<void> {
  try {
    const refs = await pipeline().taskQueue.contextRefs(taskId);

    if (!refs) {
      return;
    }
    const factIds = refs.fact_ids ?? [];
    const memoryIds = refs.memory_ids ?? [];

    await (action === "boost"
      ? memoryLifecycle().boostContributors(factIds, memoryIds)
      : memoryLifecycle().penalizeContributors(factIds, memoryIds));
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

/** Bank one successful merge for progressive trust promotion. */
export async function promoteTrust(targetRepo: string): Promise<void> {
  try {
    const repoSettings = await settings().rawSettings(targetRepo);

    if (!repoSettings) {
      return;
    }
    const trust = repoSettings.trust as RepoTrust | undefined;
    const decision = nextTrust(trust);

    if (decision.hold) {
      return;
    }

    await settings().updateSettings(targetRepo, {
      ...repoSettings,
      trust: {
        ...trust,
        level: decision.level,
        successful_tasks: decision.successfulTasks,
        ...(decision.promoted ? { promoted_at: new Date().toISOString() } : {}),
      },
    });

    if (decision.promoted) {
      console.log(
        `[job] merge-check: ${targetRepo} trust promoted to ${decision.level}`,
      );
    }
  } catch {
    /* trust promotion is best-effort */
  }
}
