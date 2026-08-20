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
  // Deliberately ONE page: this list is sliced to the most recently onboarded
  // few, so it never needed the whole set (unlike the pickers, which do).
  const repos: Repo[] = repoList.repos.slice(0, HOME_REPO_LIMIT);

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
  // Same treatment for the spec-impact workflow. A stale one is not cosmetic:
  // the backend suppresses a v1 client's findings, so the check is off until the
  // repo updates.
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
