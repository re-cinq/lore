import { query } from "../db.js";
import { platform } from "../platform.js";

interface PendingRepo {
  id: string;
  full_name: string;
  onboarding_pr_url: string;
}

export async function mergeCheckJob(): Promise<string> {
  const repos = await query<PendingRepo>(
    `SELECT id, full_name, onboarding_pr_url
     FROM lore.repos
     WHERE onboarding_pr_merged = false
       AND onboarding_pr_url IS NOT NULL`,
  );

  if (repos.length === 0) {
    console.log("[job] merge-check: no pending repos");
    return "Checked 0 repos, 0 merged";
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

      const merged = await platform().isPRMerged(fullName, parseInt(prNumber, 10));

      if (merged) {
        await query(
          `UPDATE lore.repos
           SET onboarding_pr_merged = true, last_ingested_at = now()
           WHERE id = $1`,
          [repo.id],
        );
        mergedCount++;
        console.log(`[job] merge-check: ${repo.full_name} PR merged`);
      }
    } catch (err) {
      console.error(
        `[job] merge-check: error checking ${repo.full_name}:`,
        err,
      );
    }
  }

  // Also check pipeline tasks with PRs that might have been merged
  const tasks = await query<{ id: string; target_repo: string; pr_url: string; pr_number: number; issue_number: number | null }>(
    `SELECT id, target_repo, pr_url, pr_number, issue_number
     FROM pipeline.tasks
     WHERE status = 'pr-created'
       AND pr_number IS NOT NULL
       AND pr_url IS NOT NULL`,
  );

  let tasksMerged = 0;
  for (const task of tasks) {
    try {
      const merged = await platform().isPRMerged(task.target_repo, task.pr_number);
      if (merged) {
        await query(
          `UPDATE pipeline.tasks SET status = 'merged', updated_at = now() WHERE id = $1`,
          [task.id],
        );
        await query(
          `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'pr-created', 'merged', $2)`,
          [task.id, JSON.stringify({ merged_by: "merge-check" })],
        );
        // Close the GitHub Issue if still open
        if (task.issue_number) {
          try {
            await platform().commentOnIssue(task.target_repo, task.issue_number, `PR #${task.pr_number} merged.`);
            await platform().closeIssue(task.target_repo, task.issue_number, "completed");
          } catch { /* best effort */ }
        }
        tasksMerged++;
        console.log(`[job] merge-check: task ${task.id} PR #${task.pr_number} merged`);
      }
    } catch (err) {
      console.error(`[job] merge-check: error checking task ${task.id}:`, err);
    }
  }

  return `Checked ${repos.length} repos (${mergedCount} merged), ${tasks.length} tasks (${tasksMerged} merged)`;
}
