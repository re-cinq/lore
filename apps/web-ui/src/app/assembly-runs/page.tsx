export const dynamic = "force-dynamic";
import { getFloorRuns } from "@/lib/api/floor-runs";
import { listAllRepos, reposOrThrow } from "@/lib/api/repos";
import AssemblyRunsLive from "./AssemblyRunsLive";

export default async function AssemblyLinesPage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string; status?: string; cursor?: string }>;
}) {
  const { repo, status, cursor } = await searchParams;
  const [initial, repos] = await Promise.all([
    getFloorRuns({ repo, status, cursor }),
    listAllRepos(),
  ]);

  return (
    <AssemblyRunsLive
      key={`${repo ?? ""}:${status ?? ""}:${cursor ?? ""}`}
      repo={repo}
      repos={reposOrThrow(repos).repos.map((onboarded) => onboarded.full_name)}
      activeStatus={status}
      cursor={cursor}
      initial={initial}
    />
  );
}
