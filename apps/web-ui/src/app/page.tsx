export const dynamic = "force-dynamic";
import { query } from "@/lib/db";
import { getRepoFileContent, isGitHubConfigured } from "@/lib/github";
import {
  LORE_INGEST_WORKFLOW_PATH,
  ingestWorkflowStatus,
  type IngestWorkflowStatus,
} from "@/lib/ingest-workflow";
import { getIngestStatuses } from "@/lib/ingest-status-cache";
import { fixIngestWorkflows } from "./actions";
import HomeView, { type Repo } from "./HomeView";

const HOME_REPO_LIMIT = 100;

export default async function HomePage() {
  // Query repos with activity summary, bounded to the most recently onboarded.
  const repos = await query<Repo>(
    `
    SELECT r.full_name, r.owner, r.name, r.team, r.onboarded_at,
           r.last_ingested_at, r.onboarding_pr_merged,
           (SELECT count(*)::int FROM pipeline.tasks t WHERE t.target_repo = r.full_name) as task_count,
           (SELECT count(DISTINCT agent_id)::int FROM pipeline.tasks t WHERE t.target_repo = r.full_name AND t.status = 'running') as active_agents
    FROM lore.repos r
    ORDER BY r.onboarded_at DESC
    LIMIT $1
  `,
    [HOME_REPO_LIMIT],
  );

  // Per-repo ingest-workflow alignment, TTL-cached so steady-state renders
  // make zero GitHub calls (#1027). Skipped entirely when the GitHub App
  // isn't configured so we never false-flag every repo as missing.
  let ingestStatus = new Map<string, IngestWorkflowStatus>();

  if (isGitHubConfigured()) {
    ingestStatus = await getIngestStatuses(
      repos.map((r) => r.full_name),
      (repo) =>
        getRepoFileContent(repo, LORE_INGEST_WORKFLOW_PATH).then(
          ingestWorkflowStatus,
        ),
    );
  }
  const misaligned = repos
    .filter((r) => {
      const s = ingestStatus.get(r.full_name);

      return s === "missing" || s === "stale";
    })
    .map((r) => r.full_name);

  return (
    <HomeView
      repos={repos}
      ingestStatus={ingestStatus}
      misaligned={misaligned}
      fixIngestWorkflows={fixIngestWorkflows}
    />
  );
}
