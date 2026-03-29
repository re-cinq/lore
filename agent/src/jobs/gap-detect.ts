import { query } from "../db.js";
import { callLLM } from "../anthropic.js";

interface OnboardedRepo {
  id: string;
  full_name: string;
}

export async function gapDetectJob(): Promise<string> {
  const repos = await query<OnboardedRepo>(
    `SELECT id, full_name
     FROM lore.repos
     WHERE onboarding_pr_merged = true`,
  );

  let gapsDetected = 0;

  for (const repo of repos) {
    try {
      // Check if CLAUDE.md content exists for this repo
      const chunks = await query<{ id: string }>(
        `SELECT id FROM org_shared.chunks
         WHERE source_repo = $1
           AND content_type = 'claude-md'
         LIMIT 1`,
        [repo.full_name],
      );

      if (chunks.length === 0) {
        console.log(
          `[job] gap-detect: ${repo.full_name} missing CLAUDE.md in chunks`,
        );

        // Create a gap-fill pipeline task
        await query(
          `INSERT INTO pipeline.tasks (repo_id, task_type, status, title)
           VALUES ($1, 'gap-fill', 'pending', $2)
           ON CONFLICT DO NOTHING`,
          [repo.id, `Gap fill: CLAUDE.md missing for ${repo.full_name}`],
        );

        gapsDetected++;
      }
    } catch (err) {
      console.error(
        `[job] gap-detect: error checking ${repo.full_name}:`,
        err,
      );
    }
  }

  return `Checked ${repos.length} repos, ${gapsDetected} gaps detected`;
}
