/**
 * Layer-3 handlers for GitHub events. review-reactor + auto-merge already lived in
 * Floor; the issues-labeled dispatch and the spec-PR-merge spec-task sync are
 * MOVED here from the mcp-server webhook (they do real DB + GitHub work, not just
 * a fan-out), using Floor's platform + the shared task helpers.
 */

import { randomUUID } from "node:crypto";
import {
  parseTasks,
  inferPhaseDependencies,
  syncTasksToDb,
  specSlugFromBranch,
} from "@re-cinq/lore-shared";
import { getPool } from "../kernel/db.js";
import { projectFor } from "../composition/project-boot.js";
import { settings, taskStore, taskQueue } from "../kernel/queues.js";
import { runReviewReactorForPR } from "./review/review-reactor.js";
import { tryAutoMergeForCompletedTask } from "./merge/auto-merge-trigger.js";
import type { EventHandler } from "../main-loop/types.js";

/** Resolve the backing pipeline task for a PR and re-evaluate auto-merge (no-op if none). */
async function autoMergeForPR(repo: string, prNumber: number): Promise<void> {
  const taskId = (await taskQueue().latestTaskByPr(repo, prNumber))?.id;
  if (!taskId) return;
  await tryAutoMergeForCompletedTask({ taskId });
}

/** pull_request sync/open/reopen/ready + issue_comment on a PR → review reactor. */
export const reviewReactor: EventHandler = async (params) => {
  const { repo, pr_number } = params as { repo: string; pr_number: number };
  await runReviewReactorForPR(repo, pr_number);
};

/** check_run/check_suite completed → re-evaluate auto-merge for the backing task. */
export const autoMerge: EventHandler = async (params) => {
  const { repo, pr_number } = params as { repo: string; pr_number: number };
  await autoMergeForPR(repo, pr_number);
};

/** A submitted review can flip both the review loop and the auto-merge gate. */
export const onReviewSubmitted: EventHandler = async (params) => {
  const { repo, pr_number } = params as { repo: string; pr_number: number };
  await runReviewReactorForPR(repo, pr_number);
  await autoMergeForPR(repo, pr_number);
};

/** issues.labeled dispatch: a configured label on an Issue creates a pipeline task. */
export const issuesLabeled: EventHandler = async (params) => {
  const { repo, label, issue } = params as {
    repo: string;
    label: string;
    issue: {
      number: number;
      title: string;
      body: string;
      html_url: string;
      labels: string[];
    };
  };
  let dispatchLabel = "lore";
  let dispatchDefaultType = "general";
  const repoSettings = await settings().rawSettings(repo);
  if (repoSettings) {
    const parsed = (
      typeof repoSettings === "string" ? JSON.parse(repoSettings) : repoSettings
    ) as {
      dispatch_label?: string;
      dispatch_default_type?: string;
    };
    if (parsed.dispatch_label) dispatchLabel = parsed.dispatch_label;
    if (parsed.dispatch_default_type)
      dispatchDefaultType = parsed.dispatch_default_type;
  }
  if (label !== dispatchLabel) return; // not the dispatch label → no-op

  let taskType = dispatchDefaultType;
  if (issue.labels.includes("lore:implementation")) taskType = "implementation";
  else if (issue.labels.includes("lore:review")) taskType = "review";
  else if (issue.labels.includes("lore:runbook")) taskType = "runbook";

  const issues = (await projectFor(repo)).issues;
  const existing = await taskQueue().activeTaskByIssue(repo, issue.number);
  if (existing) {
    await issues.comment(
      issue.number,
      `Already being worked on: task \`${existing.id}\``,
    );
    return;
  }

  const description = `${issue.title}\n\n${issue.body}`.trim();
  const task = await taskStore().create({
    description,
    taskType,
    targetRepo: repo,
    createdBy: "github-webhook",
    contextBundle: {
      github_issue_number: issue.number,
      github_issue_url: issue.html_url,
      github_issue_body: issue.body,
    },
  });
  await taskQueue().setColumns(task.task_id, {
    issue_number: issue.number,
    issue_url: issue.html_url,
  });
  await Promise.allSettled([
    issues.comment(
      issue.number,
      `Lore agent is working on this. Task: \`${task.task_id}\``,
    ),
    issues.addLabel(issue.number, "lore-managed"),
  ]);
};

/** pull_request closed+merged: a merged spec PR → sync its tasks.md into spec-tasks. */
export const specPrMerge: EventHandler = async (params) => {
  const { repo, branch, merged, merge_commit_sha, labels } = params as {
    repo: string;
    branch: string;
    merged: boolean;
    merge_commit_sha: string | null;
    labels: string[];
  };
  if (!merged) return; // closed-unmerged reaches here too now — only merges sync spec tasks
  if (!labels.includes("spec")) return;
  const specSlug = specSlugFromBranch(branch);
  if (!specSlug) return;

  if (await taskQueue().hasSpecTasksForSlug(repo, specSlug)) return; // already synced

  const tasksContent = await (
    await projectFor(repo)
  ).repo.read(`specs/${specSlug}/tasks.md`, merge_commit_sha ?? undefined);
  if (!tasksContent) return;

  const withDeps = inferPhaseDependencies(parseTasks(tasksContent));
  const taskGroupId = randomUUID();
  // syncTasksToDb is a shared, multi-app helper that takes the pool directly.
  await syncTasksToDb(getPool(), repo, specSlug, withDeps, taskGroupId);

  await taskQueue()
    .markFeatureRequestMergedOnBranch(repo, branch)
    .catch(() => {});
  console.log(
    `[events] spec PR merged: ${repo}/${specSlug} → spec-tasks (group ${taskGroupId})`,
  );
};
