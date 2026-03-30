import { query } from "../db.js";
import { getOctokit, commitFile, addIssueLabel, commentOnIssue } from "../github.js";
import { callLLM } from "../anthropic.js";

interface PendingTask {
  id: string;
  description: string;
  task_type: string;
  target_repo: string;
  pr_number: number;
  pr_url: string;
  issue_number: number | null;
  review_iteration: number | null;
  target_branch: string;
}

export async function reviewReactorJob(): Promise<string> {
  const tasks = await query<PendingTask>(
    `SELECT id, description, task_type, target_repo, pr_number, pr_url,
            issue_number, review_iteration, target_branch
     FROM pipeline.tasks
     WHERE status = 'pr-created'
       AND pr_number IS NOT NULL
       AND (review_iteration IS NULL OR review_iteration < 3)`,
  );

  if (tasks.length === 0) {
    console.log("[job] review-reactor: no PRs to check");
    return "Checked 0 PRs, 0 had pending feedback";
  }

  const octokit = await getOctokit();
  let feedbackCount = 0;

  for (const task of tasks) {
    try {
      const [owner, repo] = task.target_repo.split("/");

      // Get reviews
      const { data: reviews } = await octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: task.pr_number,
      });

      // Get commits to determine last commit date
      const { data: commits } = await octokit.rest.pulls.listCommits({
        owner,
        repo,
        pull_number: task.pr_number,
      });
      const lastCommitDate = new Date(
        commits[commits.length - 1]?.commit?.committer?.date || 0,
      );

      // Find "changes_requested" reviews submitted after the last commit
      const pendingReviews = reviews.filter(
        (r) =>
          r.state === "CHANGES_REQUESTED" &&
          new Date(r.submitted_at || 0) > lastCommitDate,
      );

      // Get inline review comments
      const { data: comments } = await octokit.rest.pulls.listReviewComments({
        owner,
        repo,
        pull_number: task.pr_number,
      });
      const pendingComments = comments.filter(
        (c) => new Date(c.created_at) > lastCommitDate,
      );

      if (pendingReviews.length === 0 && pendingComments.length === 0) {
        continue; // no pending feedback
      }

      await processReviewFeedback(task, pendingReviews, pendingComments);
      feedbackCount++;
    } catch (err) {
      console.error(
        `[job] review-reactor: error processing task ${task.id} (${task.target_repo}#${task.pr_number}):`,
        err,
      );
    }
  }

  return `Checked ${tasks.length} PRs, ${feedbackCount} had pending feedback`;
}

async function processReviewFeedback(
  task: PendingTask,
  reviews: any[],
  comments: any[],
): Promise<void> {
  const octokit = await getOctokit();
  const [owner, repo] = task.target_repo.split("/");

  // Get the PR diff
  const { data: diffData } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: task.pr_number,
    mediaType: { format: "diff" },
  });
  const diff = String(diffData);

  // Format review bodies
  const formattedReviews = reviews
    .map((r) => `Review by @${r.user?.login || "unknown"}: "${r.body || "(no body)"}"`)
    .join("\n\n");

  // Format inline comments
  const formattedComments = comments
    .map(
      (c) =>
        `Reviewer @${c.user?.login || "unknown"} said: "${c.body}" (on ${c.path}:${c.line || c.original_line || "?"})`,
    )
    .join("\n\n");

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

  const result = await callLLM({
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
    await commitFile(
      task.target_repo,
      task.target_branch,
      file.path,
      file.content,
      `fix: address review feedback \u2014 ${file.path}`,
    );
  }

  // Increment review_iteration
  const iterRows = await query<{ review_iteration: number }>(
    `UPDATE pipeline.tasks
     SET review_iteration = COALESCE(review_iteration, 0) + 1
     WHERE id = $1
     RETURNING review_iteration`,
    [task.id],
  );
  const iteration = iterRows[0]?.review_iteration ?? 1;

  // Post summary comment on PR
  const fileList = files.map((f) => `- \`${f.path}\``).join("\n");
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: task.pr_number,
    body: `## Review Feedback Addressed\n\nFixed ${files.length} files based on reviewer feedback.\n\n**Iteration:** ${iteration}/3\n\nChanges:\n${fileList}`,
  });

  // Comment on the linked issue if it exists
  if (task.issue_number) {
    await commentOnIssue(
      task.target_repo,
      task.issue_number,
      `Review feedback addressed (iteration ${iteration}/3). See PR for details.`,
    );
  }

  // If max iterations reached, add needs-human label and notify
  if (iteration >= 3) {
    await addIssueLabel(task.target_repo, task.pr_number, "needs-human");
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: task.pr_number,
      body: "This PR has reached the maximum of 3 review-react iterations. A human needs to take over.",
    });
  }

  // Store review corrections in agent memory for future tasks
  const corrections = reviews
    .map((r) => r.body)
    .filter(Boolean)
    .join("\n");
  if (corrections.length > 20) {
    await query(
      `INSERT INTO memory.memories (agent_id, key, value)
       VALUES ('lore-agent', $1, $2)
       ON CONFLICT (agent_id, key) DO UPDATE SET value = memory.memories.value || E'\n' || $2, version = memory.memories.version + 1`,
      [`review-lessons:${task.target_repo}`, corrections],
    );
  }

  console.log(
    `[job] review-reactor: processed task ${task.id} — ${files.length} files updated (iteration ${iteration}/3)`,
  );
}
