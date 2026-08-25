/**
 * Layer-3 handlers for GitHub events. auto-merge already lived in
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
import {
  eventReporter,
  pipeline,
  settings,
  taskStore,
} from "../kernel/queues.js";
import { tryAutoMergeForCompletedTask } from "./merge/auto-merge-trigger.js";
import {
  decideResumeFromClosedPr,
  eventReport,
  resumeDecomposition,
} from "@re-cinq/lore-shared/project/assembly-runs/decompose-resume.js";
import type { EventHandler } from "../main-loop/types.js";

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

/** A submitted review can flip the auto-merge gate (the address handling rides the
 *  code-review-reply line, wired separately in the registry). */
export const onReviewSubmitted: EventHandler = async (params) => {
  const { repo, pr_number } = params as { repo: string; pr_number: number };

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

    if (parsed.dispatch_label) {
      dispatchLabel = parsed.dispatch_label;
    }

    if (parsed.dispatch_default_type) {
      dispatchDefaultType = parsed.dispatch_default_type;
    }
  }

  if (label !== dispatchLabel) {
    return;
  } // not the dispatch label → no-op

  let taskType = dispatchDefaultType;

  if (issue.labels.includes("lore:implementation")) {
    taskType = "implementation";
  } else if (issue.labels.includes("lore:review")) {
    taskType = "review";
  } else if (issue.labels.includes("lore:runbook")) {
    taskType = "runbook";
  }

  const issues = (await projectFor(repo)).issues;
  const existing = await pipeline().taskQueue.activeTaskByIssue(
    repo,
    issue.number,
  );

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

  await pipeline().taskQueue.setColumns(task.task_id, {
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

/**
 * pull_request closed+merged: wake the line that was waiting for that PR.
 *
 * The resume already existed but was unreachable. Its only caller was
 * `handleMergedTask`, which the mergeable sweep reaches only for a task whose OWN
 * row carries a PR — and a feature-planning task is `running` with a null
 * `pr_number`, because the push node stamps the LINE's args (which is what
 * `findOpenByPr` matches on) and nothing copies it back. So a merged spec PR
 * decomposed on no deployment: not by webhook, not by the cron that is supposed to
 * be the webhook's safety net.
 *
 * Reading the merge here needs no task row. `resumeDecomposition` still targets a
 * NODE rather than the PR, so a code-review or implementation line sharing the same
 * PR is passed over rather than advanced by a step it never waited for.
 */
export const specPrResumeLine: EventHandler = async (params) => {
  const pr = decideResumeFromClosedPr(params);
  const pool = getPool();

  if (!pr || !pool) {
    return;
  }

  await resumeDecomposition(pr, {
    assemblyRuns: pipeline().assemblyRuns,
    report: eventReport(eventReporter()),
  });
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

  if (!merged) {
    return;
  } // closed-unmerged reaches here too now — only merges sync spec tasks

  if (!labels.includes("spec")) {
    return;
  }
  const specSlug = specSlugFromBranch(branch);

  if (!specSlug) {
    return;
  }

  if (await pipeline().taskQueue.hasSpecTasksForSlug(repo, specSlug)) {
    return;
  } // already synced

  const tasksContent = await (
    await projectFor(repo)
  ).repo.read(`specs/${specSlug}/tasks.md`, merge_commit_sha ?? undefined);

  if (!tasksContent) {
    return;
  }

  const withDeps = inferPhaseDependencies(parseTasks(tasksContent));
  const taskGroupId = randomUUID();

  // syncTasksToDb is a shared, multi-app helper that takes the pool directly.
  await syncTasksToDb(getPool(), repo, specSlug, withDeps, taskGroupId);

  await pipeline()
    .taskQueue.markFeatureRequestMergedOnBranch(repo, branch)
    .catch(() => {});
  console.log(
    `[events] spec PR merged: ${repo}/${specSlug} → spec-tasks (group ${taskGroupId})`,
  );
};
