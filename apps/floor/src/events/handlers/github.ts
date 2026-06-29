/**
 * Layer-3 handlers for GitHub events. review-reactor + auto-merge already lived in
 * Floor; the issues-labeled dispatch and the spec-PR-merge spec-task sync are
 * MOVED here from the mcp-server webhook (they do real DB + GitHub work, not just
 * a fan-out), using Floor's platform + the shared task helpers.
 */

import { randomUUID } from "node:crypto";
import { createPipelineTask, parseTasks, inferPhaseDependencies, syncTasksToDb } from "@re-cinq/lore-shared";
import { getPool, query } from "../../kernel/db.js";
import { GitHubPlatform } from "../../platform/github.js";
import { runReviewReactorForPR } from "../../review/review-reactor.js";
import { tryAutoMergeForCompletedTask } from "../../merge/auto-merge-trigger.js";
import type { EventHandler } from "../types.js";

/** Resolve the backing pipeline task for a PR and re-evaluate auto-merge (no-op if none). */
async function autoMergeForPR(repo: string, prNumber: number): Promise<void> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM pipeline.tasks WHERE target_repo = $1 AND pr_number = $2 ORDER BY created_at DESC LIMIT 1`,
    [repo, prNumber],
  );
  const taskId = rows[0]?.id;
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
    issue: { number: number; title: string; body: string; html_url: string; labels: string[] };
  };
  const pool = getPool();

  let dispatchLabel = "lore";
  let dispatchDefaultType = "general";
  const { rows } = await pool.query(`SELECT settings FROM lore.repos WHERE full_name = $1`, [repo]);
  if (rows.length > 0 && rows[0].settings) {
    const settings = typeof rows[0].settings === "string" ? JSON.parse(rows[0].settings) : rows[0].settings;
    if (settings.dispatch_label) dispatchLabel = settings.dispatch_label;
    if (settings.dispatch_default_type) dispatchDefaultType = settings.dispatch_default_type;
  }
  if (label !== dispatchLabel) return; // not the dispatch label → no-op

  let taskType = dispatchDefaultType;
  if (issue.labels.includes("lore:implementation")) taskType = "implementation";
  else if (issue.labels.includes("lore:review")) taskType = "review";
  else if (issue.labels.includes("lore:runbook")) taskType = "runbook";

  const gh = new GitHubPlatform();
  const { rows: existing } = await pool.query(
    `SELECT id FROM pipeline.tasks WHERE issue_number = $1 AND target_repo = $2 AND status NOT IN ('failed', 'cancelled')`,
    [issue.number, repo],
  );
  if (existing.length > 0) {
    await gh.commentOnIssue(repo, issue.number, `Already being worked on: task \`${existing[0].id}\``);
    return;
  }

  const description = `${issue.title}\n\n${issue.body}`.trim();
  const task = await createPipelineTask(pool, {
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
  await pool.query(`UPDATE pipeline.tasks SET issue_number = $1, issue_url = $2 WHERE id = $3`, [
    issue.number,
    issue.html_url,
    task.task_id,
  ]);
  await Promise.allSettled([
    gh.commentOnIssue(repo, issue.number, `Lore agent is working on this. Task: \`${task.task_id}\``),
    gh.addIssueLabel(repo, issue.number, "lore-managed"),
  ]);
};

/** pull_request closed+merged: a merged spec PR → sync its tasks.md into spec-tasks. */
export const specPrMerge: EventHandler = async (params) => {
  const { repo, branch, merge_commit_sha, labels } = params as {
    repo: string;
    branch: string;
    merge_commit_sha: string | null;
    labels: string[];
  };
  if (!branch.startsWith("lore/feature-request/") || !labels.includes("spec")) return;
  const specSlug = branch.replace("lore/feature-request/", "").replace(/-[a-f0-9]{8}$/, "");
  if (!specSlug) return;

  const pool = getPool();
  const { rows: existing } = await pool.query(
    `SELECT id FROM pipeline.tasks
      WHERE task_type = 'spec-task' AND target_repo = $1 AND context_bundle->>'spec_slug' = $2 LIMIT 1`,
    [repo, specSlug],
  );
  if (existing.length > 0) return; // already synced

  const gh = new GitHubPlatform();
  const tasksContent = await gh.getFileContent(repo, `specs/${specSlug}/tasks.md`, merge_commit_sha ?? undefined);
  if (!tasksContent) return;

  const withDeps = inferPhaseDependencies(parseTasks(tasksContent));
  const taskGroupId = randomUUID();
  await syncTasksToDb(pool, repo, specSlug, withDeps, taskGroupId);

  await pool
    .query(
      `UPDATE pipeline.tasks SET status = 'merged', updated_at = now()
        WHERE task_type = 'feature-request' AND target_repo = $1 AND target_branch = $2
          AND status IN ('pr-created', 'review')`,
      [repo, branch],
    )
    .catch(() => {});
  console.log(`[events] spec PR merged: ${repo}/${specSlug} → spec-tasks (group ${taskGroupId})`);
};
