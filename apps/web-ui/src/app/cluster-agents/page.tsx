export const dynamic = "force-dynamic";
import { getClusterAgents } from "@/lib/api/cluster-agents";
import ClusterAgentsView from "./ClusterAgentsView";

/** Container for the registered-clusters page: fetch, then hand props down. */
export default async function ClusterAgentsPage() {
  const result = await getClusterAgents();
  const body =
    result.status === "ok" ? result.data : { agents: [], offline_events: [] };

  return (
    <ClusterAgentsView
      agents={body.agents}
      offlineEvents={body.offline_events}
    />
  );
}
