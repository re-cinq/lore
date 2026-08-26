export const dynamic = "force-dynamic";
import AssemblyRunListView from "./AssemblyRunListView";
import { fetchAssemblyRuns } from "@/lib/assembly-runs";

export default async function AssemblyLinesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cluster_agent_id?: string }>;
}) {
  const { status, cluster_agent_id } = await searchParams;
  const runs = await fetchAssemblyRuns({
    status,
    clusterAgentId: cluster_agent_id,
  });

  return <AssemblyRunListView activeStatus={status} runs={runs} />;
}
