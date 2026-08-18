export const dynamic = "force-dynamic";
import RepoTasksView from "./RepoTasksView";
import { fetchAssemblyRuns } from "@/lib/assembly-runs";

export default async function RepoTasks({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const runs = await fetchAssemblyRuns({
    repo: `${owner}/${repo}`,
    limit: 100,
  });

  return <RepoTasksView owner={owner} repo={repo} runs={runs} />;
}
