export const dynamic = "force-dynamic";
import {
  getClusterAgents,
  getClusterInstallInfo,
} from "@/lib/api/cluster-agents";
import ClusterAgentsView from "./ClusterAgentsView";
import {
  toggleClusterPausedAction,
  restartClusterAgentAction,
} from "./actions";

/** Container for the registered-clusters page: fetch, then hand props down. */
export default async function ClusterAgentsPage() {
  const [result, installResult] = await Promise.all([
    getClusterAgents(),
    getClusterInstallInfo(),
  ]);
  const body =
    result.status === "ok" ? result.data : { agents: [], offline_events: [] };

  return (
    <ClusterAgentsView
      agents={body.agents}
      offlineEvents={body.offline_events}
      installInfo={installResult.status === "ok" ? installResult.data : null}
      togglePaused={toggleClusterPausedAction}
      restart={restartClusterAgentAction}
    />
  );
}
