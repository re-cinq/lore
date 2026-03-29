import { query } from "../db.js";
import { getOctokit } from "../github.js";

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

  const octokit = await getOctokit();
  let mergedCount = 0;

  for (const repo of repos) {
    try {
      // Extract owner, repoName, and PR number from URL
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

      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo: repoName,
        pull_number: parseInt(prNumber, 10),
      });

      if (pr.merged) {
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

  return `Checked ${repos.length} repos, ${mergedCount} merged`;
}
