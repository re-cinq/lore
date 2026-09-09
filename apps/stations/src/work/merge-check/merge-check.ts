// Moved from the Floor (ADR-024): once-a-minute sweep over merged/closed PRs.

import {
  pipeline,
  taskStore,
  settings,
  memoryLifecycle,
} from "../../outbound/queues.js";
import { getPool } from "@re-cinq/lore-shared/db/pg-pool.js";
import { startMergeLine } from "./start-merge-line.js";
import {} from "@re-cinq/lore-shared/project/assembly-runs/decompose-resume.js";
import { projectFor } from "../../outbound/project-boot.js";
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

/** Reads the merged tasks.md and files its spec-tasks as one group. The read is off the default branch, not the PR's: the PR is merged by the time this runs, so main is where the file now lives. */
async function syncSpecTasks(repo: string, specSlug: string): Promise<void> {
  const tasksPath = `specs/${specSlug}/tasks.md`;
  const content = await projectFor(repo).then((p) => p.repo.read(tasksPath));

  if (!content) {
    console.log(`[job] merge-check: no tasks.md at ${tasksPath}`);

    return;
  }
  const withDeps = inferPhaseDependencies(parseTasks(content));
  const taskGroupId = crypto.randomUUID();
  const { created } = await syncTasksToDb(
    getPool(),
    { repo, specSlug, taskGroupId },
    withDeps,
  );

  console.log(
    `[job] merge-check: synced ${created}/${withDeps.length} spec-tasks for ${specSlug} (group ${taskGroupId})`,
  );
}

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

  await syncSpecTasks(task.target_repo, specSlug);
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

// Closed without merging: the stored URL is cleared so onboarding can be resubmitted (#968). Leaving it would make the repo look permanently mid-onboarding.
async function clearClosedOnboarding(
  repo: PendingOnboardingRepo,
): Promise<OnboardingOutcome> {
  await settings().clearOnboardingPrUrl(repo.id);
  console.log(
    `[job] merge-check: ${repo.full_name} onboarding PR closed unmerged — cleared`,
  );

  return "closed";
}

// A stored onboarding URL this job cannot read. Logged rather than cleared: the row is someone's record of an onboarding attempt, and losing it would hide the fact that the URL was ever wrong.
function reportInvalidPrUrl(repo: PendingOnboardingRepo): OnboardingOutcome {
  console.log(
    `[job] merge-check: invalid PR URL for ${repo.full_name}: ${repo.onboarding_pr_url}`,
  );

  return "invalid";
}

/** One onboarding repo's PR check: merges/clears the row as needed, reporting what happened. */
async function checkOnboardingRepo(
  repo: PendingOnboardingRepo,
): Promise<OnboardingOutcome> {
  const parsed = parseOnboardingPrUrl(repo.onboarding_pr_url);

  if (!parsed) {
    return reportInvalidPrUrl(repo);
  }
  const project = await projectFor(`${parsed.owner}/${parsed.repoName}`);

  if (await project.pulls.isMerged(parsed.number)) {
    await settings().markOnboardingMergedById(repo.id);
    console.log(`[job] merge-check: ${repo.full_name} PR merged`);

    return "merged";
  }

  if (await project.pulls.isClosed(parsed.number)) {
    return clearClosedOnboarding(repo);
  }

  return "unchanged";
}

type MergeableOutcome = "merged" | "closed" | "unchanged";

// The run store, as the merge line reads it. Thunks, not values: the pool does not exist when this module is loaded. The LINE does the work from here — its nine steps expose failures that route forward, which a single call could not.
function mergeLinePorts(): Parameters<typeof startMergeLine>[1] {
  return {
    findOpenBySubject: (repo, key) =>
      pipeline().assemblyRuns.findOpenBySubject(repo, key),
    countBySubject: (repo, key) =>
      pipeline().assemblyRuns.countBySubject(repo, key),
    start: (input) => pipeline().assemblyRuns.start(input),
  };
}

/** One mergeable task's PR check: starts the merge line or records rejection, reporting what happened. */
async function checkMergeableTask(
  task: MergeableTask,
): Promise<MergeableOutcome> {
  const project = await projectFor(task.target_repo);

  if (await project.pulls.isMerged(task.pr_number)) {
    await startMergeLine(task, mergeLinePorts());
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

// One repo's outcome, or "unchanged" if reading it threw. Caught per repo on purpose: one repo whose PR cannot be read must not stop the sweep, because the next repo's merge is what unblocks its ingestion.
async function checkedOutcome(
  repo: PendingOnboardingRepo,
): Promise<OnboardingOutcome> {
  try {
    return await checkOnboardingRepo(repo);
  } catch (err) {
    console.error(`[job] merge-check: error checking ${repo.full_name}:`, err);

    return "unchanged";
  }
}

/** Onboarding PRs. Each repo is caught on its own — one repo whose PR cannot be read must not stop the sweep, because the next repo's merge is what unblocks its ingestion. */
async function sweepOnboardingRepos(
  repos: PendingOnboardingRepo[],
): Promise<number> {
  let mergedCount = 0;

  for (const repo of repos) {
    if ((await checkedOutcome(repo)) === "merged") {
      mergedCount++;
    }
  }

  return mergedCount;
}

/** Task PRs. The safety net for a missed `pull_request.closed` webhook — deliveries are lossy, and a merged task nobody noticed never boosts the memory that contributed to it. */
async function sweepMergeableTasks(
  tasks: MergeableTask[],
): Promise<{ merged: number; closed: number }> {
  let merged = 0;
  let closed = 0;
  const bump: Record<MergeableOutcome, () => void> = {
    merged: () => merged++,
    closed: () => closed++,
    unchanged: () => {},
  };

  for (const task of tasks) {
    try {
      bump[await checkMergeableTask(task)]();
    } catch (err) {
      console.error(`[job] merge-check: error checking task ${task.id}:`, err);
    }
  }

  return { merged, closed };
}

export async function mergeCheckJob(): Promise<string> {
  const repos = await settings().pendingOnboardingRepos();

  if (repos.length === 0) {
    console.log("[job] merge-check: no pending repos");
  }
  const mergedCount = await sweepOnboardingRepos(repos);
  const tasks = await pipeline().taskQueue.mergeableTasks();
  const taskCounts = await sweepMergeableTasks(tasks);

  return `Checked ${repos.length} repos (${mergedCount} merged), ${tasks.length} tasks (${taskCounts.merged} merged, ${taskCounts.closed} rejected)`;
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

// The audit entry for what the outcome did to the contributing facts and memories. Swallows its own failure: the boost or penalty has already landed, and losing the record of it is not a reason to report the feedback as failed.
async function recordFeedback(
  taskId: string,
  action: "boost" | "penalize",
  factIds: string[],
  memoryIds: string[],
): Promise<void> {
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
    await recordFeedback(taskId, action, factIds, memoryIds);
  } catch {
    /* outcome feedback is best-effort */
  }
}

// The trust block after banking one merge. `promoted_at` is stamped only on an actual promotion — every merge moves the count, but only the one that crosses a tier is a moment worth dating.
function promotedTrust(
  trust: TrustState | undefined,
  decision: ReturnType<typeof nextTrust>,
) {
  return {
    ...trust,
    level: decision.level,
    successful_tasks: decision.successfulTasks,
    ...(decision.promoted ? { promoted_at: new Date().toISOString() } : {}),
  };
}

// Moves the repo's trust one merge forward. A repo with no settings row and a decision that holds are both no-ops: trust is banked, not inferred, so a repo Lore knows nothing about does not start climbing.
async function bankMerge(targetRepo: string): Promise<void> {
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
    trust: promotedTrust(trust, decision),
  });

  if (decision.promoted) {
    console.log(
      `[job] merge-check: ${targetRepo} trust promoted to ${decision.level}`,
    );
  }
}

/** Bank one successful merge for progressive trust promotion. */
export async function promoteTrust(targetRepo: string): Promise<void> {
  try {
    await bankMerge(targetRepo);
  } catch {
    /* trust promotion is best-effort */
  }
}
