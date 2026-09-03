export const dynamic = "force-dynamic";
import { listRepos, reposOrThrow } from "@/lib/api/repos";
import { getRepoFileContent, isGitHubConfigured } from "@/lib/github";
import {
  LORE_INGEST_WORKFLOW_PATH,
  ingestWorkflowStatus,
  type IngestWorkflowStatus,
} from "@/lib/ingest-workflow";
import {
  TRACE_IMPACT_WORKFLOW_PATH,
  traceImpactWorkflowStatus,
} from "@/lib/trace-impact-workflow";
import {
  getIngestStatuses,
  getWorkflowStatuses,
} from "@/lib/ingest-status-cache";
import { fixIngestWorkflows, fixTraceImpactWorkflows } from "./actions";
import HomeView, { type Repo } from "./HomeView";

const HOME_REPO_LIMIT = 100;

export default async function HomePage() {
  // Query repos with activity summary, bounded to the most recently onboarded.
  const repoList = reposOrThrow(await listRepos());
  // ONE page only: most recently onboarded repos (unlike pickers).
  const repos: Repo[] = repoList.repos.slice(0, HOME_REPO_LIMIT);

  // Per-repo ingest-workflow: TTL-cached, zero GitHub calls (#1027) when App unconfigured.
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
  // Spec-impact workflow: stale suppresses v1 findings, check off until repo updates.
  let impactStatus = new Map<string, IngestWorkflowStatus>();

  if (isGitHubConfigured()) {
    impactStatus = await getWorkflowStatuses(
      "trace-impact",
      repos.map((r) => r.full_name),
      (repo) =>
        getRepoFileContent(repo, TRACE_IMPACT_WORKFLOW_PATH).then(
          traceImpactWorkflowStatus,
        ),
    );
  }
  const needsFix = (status: Map<string, IngestWorkflowStatus>) =>
    repos
      .filter((r) => {
        const s = status.get(r.full_name);

        return s === "missing" || s === "stale";
      })
      .map((r) => r.full_name);
  const misaligned = needsFix(ingestStatus);
  const impactMisaligned = needsFix(impactStatus);

  return (
    <HomeView
      repos={repos}
      ingestStatus={ingestStatus}
      impactMisaligned={impactMisaligned}
      fixTraceImpactWorkflows={fixTraceImpactWorkflows}
      misaligned={misaligned}
      fixIngestWorkflows={fixIngestWorkflows}
    />
  );
}
