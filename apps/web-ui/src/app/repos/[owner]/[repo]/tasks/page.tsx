export const dynamic = "force-dynamic";
import RepoTasksView from "./RepoTasksView";
import { fetchAssemblyLineRuns } from "@/lib/assembly-line-runs";

export default async function RepoTasks({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const runs = await fetchAssemblyLineRuns({
    repo: `${owner}/${repo}`,
    limit: 100,
  });

  return <RepoTasksView owner={owner} repo={repo} runs={runs} />;
}
