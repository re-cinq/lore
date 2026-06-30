import { taskQueue, memoryLifecycle } from "../../kernel/queues.js";
import { projectFor } from "../../composition/project-boot.js";
import { Llm } from "@re-cinq/lore-shared";
import type { ReviewableTask } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";
import { writeEpisode } from "../memory/episode-writer.js";
import { isBusinessHours } from "@re-cinq/lore-shared";

type PendingTask = ReviewableTask;

/**
 * Safety-net polling entry point. Webhooks are the primary trigger — this
 * runs on a business-hours cron to catch PRs whose webhook delivery was
 * dropped. Off-hours invocations no-op.
 */
export async function reviewReactorJob(): Promise<string> {
  if (!isBusinessHours()) {
    return "Skipped: outside business hours";
  }

  const tasks = await taskQueue().reviewable();

  if (tasks.length === 0) {
    console.log("[job] review-reactor: no PRs to check");
    return "Checked 0 PRs, 0 had pending feedback";
  }

  let feedbackCount = 0;

  for (const task of tasks) {
    try {
      const processed = await checkAndProcessPR(task);
      if (processed) feedbackCount++;
    } catch (err) {
      console.error(
        `[job] review-reactor: error processing task ${task.id} (${task.target_repo}#${task.pr_number}):`,
        err,
      );
    }
  }

  return `Checked ${tasks.length} PRs, ${feedbackCount} had pending feedback`;
}

/**
 * Run the reactor for a single PR. Called by the webhook endpoint on
 * pull_request.synchronize or pull_request_review.submitted events.
 * Returns the number of feedback batches processed (0 or 1).
 */
export async function runReviewReactorForPR(
  repo: string,
  prNumber: number,
): Promise<{ processed: boolean; reason?: string }> {
  const task = await taskQueue().reviewableForPR(repo, prNumber);

  if (!task) {
    return { processed: false, reason: "no matching task" };
  }

  try {
    const processed = await checkAndProcessPR(task);
    return { processed };
  } catch (err) {
    console.error(
      `[webhook] review-reactor: error processing ${repo}#${prNumber}:`,
      err,
    );
    return { processed: false, reason: (err as Error).message };
  }
}

/**
 * Check one PR for pending feedback and run processReviewFeedback if so.
 * Returns true if feedback was processed.
 */
async function checkAndProcessPR(task: PendingTask): Promise<boolean> {
  const project = await projectFor(task.target_repo);
  const reviews = await project.pulls.listReviews(task.pr_number);

  const commits = await project.pulls.listCommits(task.pr_number);
  const lastCommitDate = new Date(commits[commits.length - 1]?.date || 0);

  const pendingReviews = reviews.filter(
    (r) =>
      r.state === "CHANGES_REQUESTED" &&
      new Date(r.submitted_at || 0) > lastCommitDate,
  );

  const comments = await project.pulls.listComments(task.pr_number);
  const pendingComments = comments.filter(
    (c) => new Date(c.created_at) > lastCommitDate,
  );

  const issueComments = await project.pulls.listIssueComments(task.pr_number);
  const pendingIssueComments = issueComments.filter(
    (c) => new Date(c.created_at) > lastCommitDate,
  );

  if (pendingReviews.length === 0 && pendingComments.length === 0 && pendingIssueComments.length === 0) {
    return false;
  }

  const allComments = [
    ...pendingComments,
    ...pendingIssueComments.map((c) => ({
      id: 0, path: "(general)", line: null,
      body: c.body, user: c.user, created_at: c.created_at,
    })),
  ];

  await processReviewFeedback(task, pendingReviews, allComments);
  return true;
}

async function processReviewFeedback(
  task: PendingTask,
  reviews: any[],
  comments: any[],
): Promise<void> {
  const project = await projectFor(task.target_repo);
  // Get the PR diff
  const diff = await project.pulls.getDiff(task.pr_number);

  // Format review bodies
  const formattedReviews = reviews
    .map((r) => `Review by @${r.user || "unknown"}: "${r.body || "(no body)"}"`)
    .join("\n\n");

  // Format inline comments
  const formattedComments = comments
    .map(
      (c) =>
        `Reviewer @${c.user || "unknown"} said: "${c.body}" (on ${c.path}:${c.line || "?"})`,
    )
    .join("\n\n");

  // Capture review feedback as an episode for org-wide learning
  const episodeContent = `PR #${task.pr_number} on ${task.target_repo}\n\n${formattedReviews}\n\n${formattedComments}`;
  writeEpisode(episodeContent, "pr-review", `${task.target_repo}#${task.pr_number}`, "review-reactor").catch(() => {});

  const prompt = `You are fixing review feedback on a pull request.

Original task: ${task.description}

## Review Feedback
${formattedReviews}

## Inline Comments
${formattedComments}

## Current PR Diff
${diff}

Fix the issues raised by the reviewer. Output ONLY the corrected file contents.
For each file that needs changes, output:

=== FILE: path/to/file.ts ===
(full corrected file content)
=== END FILE ===`;

  const result = await Llm.instance.complete({
    prompt,
    taskId: task.id,
    jobName: "review_reactor",
  });

  // Parse output for file blocks
  const fileBlockRegex = /=== FILE: (.+?) ===\n([\s\S]*?)(?:\n=== END FILE ===)/g;
  const files: { path: string; content: string }[] = [];
  let match;
  while ((match = fileBlockRegex.exec(result.text)) !== null) {
    files.push({ path: match[1].trim(), content: match[2] });
  }

  // Commit each changed file
  for (const file of files) {
    await project.repo.commitFile(
      task.target_branch,
      file.path,
      file.content,
      `fix: address review feedback \u2014 ${file.path}`,
    );
  }

  // Increment review_iteration
  const iteration = await taskQueue().incrementReviewIteration(task.id);

  // Post summary comment on PR
  const fileList = files.map((f) => `- \`${f.path}\``).join("\n");
  await project.pulls.comment(
    task.pr_number,
    `## Review Feedback Addressed\n\nFixed ${files.length} files based on reviewer feedback.\n\n**Iteration:** ${iteration}/3\n\nChanges:\n${fileList}`,
  );

  // Comment on the linked issue if it exists
  if (task.issue_number) {
    await project.issues.comment(
      task.issue_number,
      `Review feedback addressed (iteration ${iteration}/3). See PR for details.`,
    );
  }

  // If max iterations reached, add needs-human label and notify
  if (iteration >= 3) {
    await project.pulls.addLabel(task.pr_number, "needs-human");
    await project.pulls.comment(
      task.pr_number,
      "This PR has reached the maximum of 3 review-react iterations. A human needs to take over.",
    );
  }

  // Store review corrections in agent memory for future tasks
  const corrections = reviews
    .map((r) => r.body)
    .filter(Boolean)
    .join("\n");
  if (corrections.length > 20) {
    await memoryLifecycle().appendMemory("lore-agent", `review-lessons:${task.target_repo}`, corrections);
  }

  console.log(
    `[job] review-reactor: processed task ${task.id} — ${files.length} files updated (iteration ${iteration}/3)`,
  );
}
