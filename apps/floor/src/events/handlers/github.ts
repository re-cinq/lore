/** Layer-3 handlers for GitHub events still answered here: the auto-merge re-evaluation and what a merged spec PR starts. The label dispatch, the repository rename and the overlay drop moved to the stations service (specs/external-floor FR16). */

import { randomUUID } from "node:crypto";
import {
  parseTasks,
  inferPhaseDependencies,
  syncTasksToDb,
  specSlugFromBranch,
} from "@re-cinq/lore-shared";
import { getPool } from "../../outbound/db.js";
import { projectFor } from "../../outbound/project-boot.js";
import { eventReporter, pipeline } from "../../outbound/queues.js";
import { tryAutoMergeForCompletedTask } from "../../work/merge/auto-merge-trigger.js";
import {
  decideResumeFromClosedPr,
  eventReport,
  resumeDecomposition,
} from "@re-cinq/lore-shared/project/assembly-runs/decompose-resume.js";
import type { EventHandler } from "../../domain/event-types.js";

/** Resolve the backing pipeline task for a PR and re-evaluate auto-merge (no-op if none). */
async function autoMergeForPR(repo: string, prNumber: number): Promise<void> {
  const taskId = (await pipeline().taskQueue.latestTaskByPr(repo, prNumber))
    ?.id;

  if (!taskId) {
    return;
  }
  await tryAutoMergeForCompletedTask({ taskId });
}

/** check_run/check_suite completed → re-evaluate auto-merge for the backing task. */
export const autoMerge: EventHandler = async (params) => {
  const { repo, pr_number } = params as { repo: string; pr_number: number };

  await autoMergeForPR(repo, pr_number);
};

/** A submitted review can flip the auto-merge gate (the address handling rides the code-review-reply line, wired separately in the registry). */
export const onReviewSubmitted: EventHandler = async (params) => {
  const { repo, pr_number } = params as { repo: string; pr_number: number };

  await autoMergeForPR(repo, pr_number);
};

/** pull_request closed+merged: wake the line waiting for that PR. Previously unreachable — a feature-planning task's null `pr_number` (the push node stamps only the LINE's args) meant a merged spec PR decomposed on no deployment; this reads the merge directly, needing no task row, and still targets a NODE so a line sharing the PR but not waiting on it is passed over. */
export const specPrResumeLine: EventHandler = async (params) => {
  const pr = decideResumeFromClosedPr(params);

  getPool();

  if (!pr) {
    return;
  }

  await resumeDecomposition(pr, {
    assemblyRuns: pipeline().assemblyRuns,
    report: eventReport(eventReporter()),
  });
};

/** The spec slug of a PR carrying the `spec` label — the only PRs whose tasks.md should sync. Callers gate on `merged` themselves, since closed-unmerged reaches this event too. */
function specLabelledSlug(labels: string[], branch: string): string | null {
  return labels.includes("spec") ? specSlugFromBranch(branch) : null;
}

/** Files a merged spec PR's tasks.md as spec-tasks; an unreadable tasks.md is a no-op. */
async function syncSpecTasks(
  repo: string,
  branch: string,
  specSlug: string,
  mergeCommitSha: string | null,
): Promise<void> {
  const taskGroupId = await syncMergedTasks(repo, specSlug, mergeCommitSha);

  if (!taskGroupId) {
    return;
  }

  const { taskQueue } = pipeline();

  await taskQueue
    .markFeatureRequestMergedOnBranch(repo, branch)
    .catch(() => {});
  console.log(
    `[events] spec PR merged: ${repo}/${specSlug} → spec-tasks (group ${taskGroupId})`,
  );
}

/** Reads tasks.md AT THE MERGE COMMIT and files its spec-tasks as one group. The commit matters: reading the branch would race a branch already deleted, and reading HEAD would pick up whatever merged after. */
async function syncMergedTasks(
  repo: string,
  specSlug: string,
  mergeCommitSha: string | null,
): Promise<string | null> {
  const tasksContent = await (
    await projectFor(repo)
  ).repo.read(`specs/${specSlug}/tasks.md`, mergeCommitSha ?? undefined);

  if (!tasksContent) {
    return null;
  }
  const taskGroupId = randomUUID();

  // syncTasksToDb is a shared, multi-app helper that takes the pool directly.
  await syncTasksToDb(
    getPool(),
    { repo, specSlug, taskGroupId },
    inferPhaseDependencies(parseTasks(tasksContent)),
  );

  return taskGroupId;
}

/** pull_request closed+merged: a merged spec PR → sync its tasks.md into spec-tasks. */
export const specPrMerge: EventHandler = async (params) => {
  const { repo, branch, merged, merge_commit_sha, labels } = params as {
    repo: string;
    branch: string;
    merged: boolean;
    merge_commit_sha: string | null;
    labels: string[];
  };

  const specSlug = merged ? specLabelledSlug(labels, branch) : null;

  if (!specSlug) {
    return;
  }
  const { taskQueue } = pipeline();

  // already synced
  if (await taskQueue.hasSpecTasksForSlug(repo, specSlug)) {
    return;
  }

  await syncSpecTasks(repo, branch, specSlug, merge_commit_sha);
};
