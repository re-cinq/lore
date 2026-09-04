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
import { nextTrust, type TrustState } from "../lib/trust-ladder.js";
import {
  parseTasks,
  inferPhaseDependencies,
  syncTasksToDb,
  specSlugFromBranch,
} from "@re-cinq/lore-shared";
import type { MergeableTask } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";
import type { PendingOnboardingRepo } from "@re-cinq/lore-shared/project/settings/settings-port.js";

export {
  decideSpecStatusFlip,
  decideFeatureImplemented,
  describeFlipSuccess,
  describeFlipMiss,
  maybeFlipSpecStatus,
} from "./spec-status-flip.js";

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

/** Extracts owner/repo and PR number from a github.com pull URL, or null when the URL is not one. */
export function parseOnboardingPrUrl(
  url: string,
): { owner: string; repoName: string; number: number } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);

  if (!match) {
    return null;
  }
  const [, owner, repoName, prNumber] = match;

  return { owner, repoName, number: parseInt(prNumber, 10) };
}

type OnboardingOutcome = "merged" | "closed" | "invalid" | "unchanged";

/** One onboarding repo's PR check: merges/clears the row as needed, reporting what happened. */
async function checkOnboardingRepo(
  repo: PendingOnboardingRepo,
): Promise<OnboardingOutcome> {
  const parsed = parseOnboardingPrUrl(repo.onboarding_pr_url);

  if (!parsed) {
    console.log(
      `[job] merge-check: invalid PR URL for ${repo.full_name}: ${repo.onboarding_pr_url}`,
    );

    return "invalid";
  }
  const project = await projectFor(`${parsed.owner}/${parsed.repoName}`);

  if (await project.pulls.isMerged(parsed.number)) {
    await settings().markOnboardingMergedById(repo.id);
    console.log(`[job] merge-check: ${repo.full_name} PR merged`);

    return "merged";
  }

  // Closed without merging: clear onboarding URL to allow resubmission (#968).
  if (await project.pulls.isClosed(parsed.number)) {
    await settings().clearOnboardingPrUrl(repo.id);
    console.log(
      `[job] merge-check: ${repo.full_name} onboarding PR closed unmerged — cleared`,
    );

    return "closed";
  }

  return "unchanged";
}

type MergeableOutcome = "merged" | "closed" | "unchanged";

/** One mergeable task's PR check: starts the merge line or records rejection, reporting what happened. */
async function checkMergeableTask(
  task: MergeableTask,
): Promise<MergeableOutcome> {
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
    console.log(
      `[job] merge-check: task ${task.id} PR #${task.pr_number} merged`,
    );

    return "merged";
  }

  // Closed-without-merge is a rejection signal.
  if (await project.pulls.isClosed(task.pr_number)) {
    await handleRejectedTask(task);
    console.log(
      `[job] merge-check: task ${task.id} PR #${task.pr_number} closed (rejected)`,
    );

    return "closed";
  }

  return "unchanged";
}

export async function mergeCheckJob(): Promise<string> {
  const repos = await settings().pendingOnboardingRepos();

  if (repos.length === 0) {
    console.log("[job] merge-check: no pending repos");
  }

  let mergedCount = 0;

  const bumpRepoOutcome: Record<OnboardingOutcome, () => void> = {
    merged: () => mergedCount++,
    closed: () => {},
    invalid: () => {},
    unchanged: () => {},
  };

  for (const repo of repos) {
    try {
      bumpRepoOutcome[await checkOnboardingRepo(repo)]();
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

  const bumpTaskOutcome: Record<MergeableOutcome, () => void> = {
    merged: () => tasksMerged++,
    closed: () => tasksClosed++,
    unchanged: () => {},
  };

  for (const task of tasks) {
    try {
      bumpTaskOutcome[await checkMergeableTask(task)]();
    } catch (err) {
      console.error(`[job] merge-check: error checking task ${task.id}:`, err);
    }
  }

  return `Checked ${repos.length} repos (${mergedCount} merged), ${tasks.length} tasks (${tasksMerged} merged, ${tasksClosed} rejected)`;
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
    const trust = repoSettings.trust as TrustState | undefined;
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
