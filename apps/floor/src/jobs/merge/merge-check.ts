import { errorMessage } from "@re-cinq/lore-shared";
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
  openSpecStatusFlipPr,
} from "@re-cinq/lore-shared";
import type { Project, StatusFlipResult } from "@re-cinq/lore-shared";
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
      const number = parseInt(prNumber, 10);
      const project = await projectFor(fullName);
      const pr = await project.pulls.get(number);

      if (!pr) {
        console.log(
          `[job] merge-check: could not read PR for ${repo.full_name} — skipped`,
        );
        continue;
      }

      if (pr.state === "merged") {
        await settings().markOnboardingMergedById(repo.id);
        mergedCount++;
        console.log(`[job] merge-check: ${repo.full_name} PR merged`);
        continue;
      }

      // Closed without merging — the usual outcome when the scaffolding came
      // out wrong. The url no longer describes an onboarding in progress, and
      // leaving it set would refuse every later submission for this repo as
      // "pr-open" forever, since nothing else ever clears it (#968).
      if (pr.state === "closed") {
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
  const tasks = await taskQueue().mergeableTasks();

  let tasksMerged = 0;
  let tasksClosed = 0;

  for (const task of tasks) {
    try {
      const project = await projectFor(task.target_repo);
      const pr = await project.pulls.get(task.pr_number);

      if (!pr) {
        console.log(
          `[job] merge-check: could not read PR #${task.pr_number} for task ${task.id} — skipped`,
        );
        continue;
      }

      if (pr.state === "merged") {
        await handleMergedTask(project, task);
        tasksMerged++;
        console.log(
          `[job] merge-check: task ${task.id} PR #${task.pr_number} merged`,
        );
        continue;
      }

      // Closed-without-merge is a rejection signal.
      if (pr.state === "closed") {
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

/**
 * spec-status-upkeep FR1 gate (pure). Returns the owning `featureId` when a
 * just-merged task completes its feature's group — a spec-task, in a group,
 * with `remainingInGroup === 0`, carrying a `feature_id` — else null.
 */
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

/**
 * Keep the features table and the spec file in sync (FR1's invariant): a feature
 * is implemented only when its spec now claims `shipped` — freshly flipped, or
 * already claiming it. An `in-progress` outcome (test-link coverage short of
 * full), a missing / status-row-less / terminal spec, or one with no testable
 * statement to confirm the claim, is left for a human to reconcile.
 */
export function decideFeatureImplemented(result: StatusFlipResult): boolean {
  return (
    result.status === "shipped" &&
    (!result.skipped || result.reason === "already-current")
  );
}

/**
 * spec-status-upkeep FR1. When `task`'s merge completes its feature's task
 * group, resolve the owning feature and open a deterministic one-line PR setting
 * the spec's `| Status |` header to whatever its test-link coverage entitles it
 * to claim, then transition the feature to `implemented` only if that status is
 * `shipped`. A merged task group no longer implies completion on its own — a
 * spec whose statements are not all linked lands `In Progress`, and its feature
 * is left for a human to reconcile. No-op for non-spec-tasks, groupless tasks,
 * incomplete groups, or unresolvable features.
 */
async function maybeFlipSpecStatus(
  project: Project,
  task: MergeableTask,
): Promise<void> {
  const remaining = task.task_group_id
    ? await taskQueue().countUnmergedInGroup(task.task_group_id)
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

  // Backstop for the repo sweep: if the onboarding PR closed and was later
  // reopened, the sweep already cleared onboarding_pr_url and dropped the repo
  // — the task (which keeps its pr_url) is then the only path that still sees
  // the merge, and without this the repo is never marked onboarded.
  if (task.task_type === "onboard" && task.target_repo) {
    try {
      await settings().markOnboardingMergedByRepo(task.target_repo);
    } catch (err) {
      console.error(
        `[job] merge-check: onboarding mark failed for ${task.target_repo}: ${errorMessage(err)}`,
      );
    }
  }

  // spec-status-upkeep (FR1): when this merge completes a feature's task group,
  // flip the spec's status header to Implemented and mark the feature done.
  try {
    await maybeFlipSpecStatus(project, task);
  } catch (err) {
    console.error(
      `[job] merge-check: spec-status flip failed for ${task.id}: ${errorMessage(err)}`,
    );
  }

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
    } catch (err) {
      console.error(
        `[job] merge-check: spec-task sync failed for ${task.id}: ${errorMessage(err)}`,
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
    } catch (err) {
      console.error(
        `[job] merge-check: could not kick decompose for ${task.id}: ${errorMessage(err)}`,
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
