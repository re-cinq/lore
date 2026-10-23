export const dynamic = "force-dynamic";
import { getFloorRuns } from "@/lib/api/floor-runs";
import { listAllRepos, reposOrThrow } from "@/lib/api/repos";
import AssemblyRunsLive from "./AssemblyRunsLive";

interface RunsSearch {
  repo?: string;
  status?: string;
  cursor?: string;
}

export default async function AssemblyLinesPage(props: {
  searchParams: Promise<RunsSearch>;
}) {
  const { repo, status, cursor } = await props.searchParams;
  const [initial, repos] = await Promise.all([
    getFloorRuns({ repo, status, cursor }),
    onboardedRepoNames(),
  ]);

  return (
    <AssemblyRunsLive
      key={`${repo ?? ""}:${status ?? ""}:${cursor ?? ""}`}
      repo={repo}
      repos={repos}
      activeStatus={status}
      cursor={cursor}
      initial={initial}
    />
  );
}

async function onboardedRepoNames(): Promise<string[]> {
  const { repos } = reposOrThrow(await listAllRepos());

  return repos.map((onboarded) => onboarded.full_name);
}
