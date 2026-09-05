/** Layer-3 handlers for GitHub events; issues-labeled dispatch and the spec-PR-merge spec-task sync were MOVED here from the mcp-server webhook (real DB + GitHub work, not just a fan-out). */

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
import { dispatchTypeFromLabels } from "@re-cinq/lore-shared/task-types/dispatch-labels.js";

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

interface IssueDispatchSettings {
  dispatchLabel: string;
  dispatchDefaultType: string;
}

/** Parses the repo's raw settings blob (string or already-parsed) into dispatch label/type, falling back to defaults. */
function resolveIssueDispatch(repoSettings: unknown): IssueDispatchSettings {
  const defaults: IssueDispatchSettings = {
    dispatchLabel: "lore",
    dispatchDefaultType: "general",
  };

  if (!repoSettings) {
    return defaults;
  }
  const parsed = (
    typeof repoSettings === "string" ? JSON.parse(repoSettings) : repoSettings
  ) as {
    dispatch_label?: string;
    dispatch_default_type?: string;
  };

  return {
    dispatchLabel: parsed.dispatch_label || defaults.dispatchLabel,
    dispatchDefaultType:
      parsed.dispatch_default_type || defaults.dispatchDefaultType,
  };
}

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
  const repoSettings = await settings().rawSettings(repo);
  const { dispatchLabel, dispatchDefaultType } =
    resolveIssueDispatch(repoSettings);

  if (label !== dispatchLabel) {
    return;
  } // not the dispatch label → no-op

  // The same table onboarding seeds the repo from — GIVEN and UNDERSTOOD labels must be one declaration, or a seeded label silently dispatches as the default type.
  const taskType = dispatchTypeFromLabels(issue.labels) ?? dispatchDefaultType;

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

/** True when a merged PR carries the `spec` label and its branch names a spec slug — the only PRs whose tasks.md should sync. Closed-unmerged reaches this event too, so `merged` is checked first. */
function mergedSpecSlug(
  merged: boolean,
  labels: string[],
  branch: string,
): string | null {
  if (!merged || !labels.includes("spec")) {
    return null;
  }

  return specSlugFromBranch(branch);
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

  const specSlug = mergedSpecSlug(merged, labels, branch);

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
  await syncTasksToDb(getPool(), { repo, specSlug, taskGroupId }, withDeps);

  await pipeline()
    .taskQueue.markFeatureRequestMergedOnBranch(repo, branch)
    .catch(() => {});
  console.log(
    `[events] spec PR merged: ${repo}/${specSlug} → spec-tasks (group ${taskGroupId})`,
  );
};
