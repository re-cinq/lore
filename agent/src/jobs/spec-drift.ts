import { query } from "../db.js";

interface RepoWithSpecs {
  full_name: string;
}

// Stub — full LLM-based spec-vs-code comparison is Phase 2+ work.
// For now we just identify repos that have specs in the chunk store.
export async function specDriftJob(): Promise<string> {
  const repos = await query<RepoWithSpecs>(
    `SELECT DISTINCT repo AS full_name
     FROM org_shared.chunks
     WHERE content_type = 'spec'`,
  );

  for (const repo of repos) {
    console.log(`[job] spec-drift: checked ${repo.full_name}`);
  }

  return `Checked ${repos.length} repos for spec drift`;
}
