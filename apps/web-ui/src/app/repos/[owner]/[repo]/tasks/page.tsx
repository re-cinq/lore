export const dynamic = "force-dynamic";
import RepoTasksView from "./RepoTasksView";
import { getFloorRuns } from "@/lib/api/floor-runs";
import { fetchAssemblyRuns } from "@/lib/assembly-runs";

export default async function RepoTasks({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const { owner, repo: name } = await params;
  const { status, cursor } = await searchParams;
  const repo = `${owner}/${name}`;
  const [initial, earlierRuns] = await Promise.all([
    getFloorRuns({ repo, status, cursor }),
    fetchAssemblyRuns({ repo, engine: "lore", status, limit: 100 }),
  ]);
  const view = { repo, activeStatus: status, cursor, initial, earlierRuns };

  return <RepoTasksView key={`${status ?? ""}:${cursor ?? ""}`} {...view} />;
}
