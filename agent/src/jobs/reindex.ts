import { query } from "../db.js";

interface OnboardedRepo {
  full_name: string;
  last_ingested_at: Date | null;
}

// TODO: Integrate Vertex AI text-embedding-005 for full re-embedding.
// Currently this job only identifies repos that need reindexing.
export async function reindexJob(): Promise<string> {
  const repos = await query<OnboardedRepo>(
    `SELECT full_name, last_ingested_at
     FROM lore.repos
     WHERE onboarding_pr_merged = true`,
  );

  for (const repo of repos) {
    const lastIngested = repo.last_ingested_at
      ? repo.last_ingested_at.toISOString()
      : "never";
    console.log(
      `[job] reindex: ${repo.full_name} last ingested ${lastIngested}`,
    );
  }

  return `Checked ${repos.length} repos for reindex`;
}
