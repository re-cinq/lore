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

  const { ingestStatus, impactStatus } = await readWorkflowStatuses(repos);
  const misaligned = needsFix(repos, ingestStatus);
  const impactMisaligned = needsFix(repos, impactStatus);

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

/** Both workflow checks, or empty maps. Skipped entirely when the GitHub App is unconfigured — that path made zero GitHub calls (#1027). */
async function readWorkflowStatuses(repos: Repo[]) {
  if (!isGitHubConfigured()) {
    return noWorkflowStatuses();
  }
  const names = repos.map((r) => r.full_name);
  const [ingestStatus, impactStatus] = await Promise.all([
    getIngestStatuses(names, (repo) =>
      getRepoFileContent(repo, LORE_INGEST_WORKFLOW_PATH).then(
        ingestWorkflowStatus,
      ),
    ),
    getWorkflowStatuses("trace-impact", names, (repo) =>
      getRepoFileContent(repo, TRACE_IMPACT_WORKFLOW_PATH).then(
        traceImpactWorkflowStatus,
      ),
    ),
  ]);

  return { ingestStatus, impactStatus };
}

/** What an unconfigured GitHub App answers with: empty maps, which read downstream as "nothing to fix" rather than as an error. */
function noWorkflowStatuses() {
  return {
    ingestStatus: new Map<string, IngestWorkflowStatus>(),
    impactStatus: new Map<string, IngestWorkflowStatus>(),
  };
}

/** The repos whose workflow is missing or stale. A stale spec-impact workflow suppresses that repo's findings, so it is offered for fixing exactly like a missing one. */
function needsFix(repos: Repo[], status: Map<string, IngestWorkflowStatus>) {
  return repos
    .filter((r) => {
      const s = status.get(r.full_name);

      return s === "missing" || s === "stale";
    })
    .map((r) => r.full_name);
}
