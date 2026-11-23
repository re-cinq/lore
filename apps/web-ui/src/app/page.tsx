export const dynamic = "force-dynamic";
import { listRepos, reposOrThrow } from "@/lib/api/repos";
import { getRepoFileContent } from "@/lib/github";
import {
  LORE_INGEST_WORKFLOW_PATH,
  ingestWorkflowStatus,
} from "@/lib/ingest-workflow";
import {
  TRACE_IMPACT_WORKFLOW_PATH,
  traceImpactWorkflowStatus,
} from "@/lib/trace-impact-workflow";
import {
  getIngestStatuses,
  getWorkflowStatuses,
} from "@/lib/ingest-status-cache";
import { updateSetup } from "./actions";
import {
  reposNeedingSetupUpdate,
  reposNeedingWorkflowFix,
} from "@/lib/workflow-fix";
import HomeView, { type Repo } from "./HomeView";
import { parseRepoFilter } from "./HomeView.filters";

const HOME_REPO_LIMIT = 100;

interface HomePageProps {
  searchParams: Promise<{ filter?: string | string[] }>;
}

export default async function HomePage(props: HomePageProps) {
  const { filter } = await props.searchParams;
  // Query repos with activity summary, bounded to the most recently onboarded.
  const repoList = reposOrThrow(await listRepos());
  // ONE page only: most recently onboarded repos (unlike pickers).
  const repos: Repo[] = repoList.repos.slice(0, HOME_REPO_LIMIT);

  const { ingestStatus, impactStatus } = await readWorkflowStatuses(repos);

  return (
    <HomeView
      repos={repos}
      ingestStatus={ingestStatus}
      impactMisaligned={reposNeedingWorkflowFix(repos, impactStatus)}
      needsUpdate={reposNeedingSetupUpdate(repos, ingestStatus, impactStatus)}
      updateSetup={updateSetup}
      filter={parseRepoFilter(filter)}
    />
  );
}

/** Both workflow checks, read through lore-api. */
async function readWorkflowStatuses(repos: Repo[]) {
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
