// Whether THIS Floor can interrogate a station run's Agent CR.
//
// Extracted from the reaper because BOTH terminal doors need it and the reaper
// already imports the event handler — the predicate could not live on either
// side without a cycle. It answers one question, and the answer is the
// difference between "the agent produced nothing" and "we were never able to
// look", which are the same `null` and opposite facts.

import type { StationRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";

/**
 * Only two rows qualify: a legacy `running` row (the pre-flip push path launched
 * its CR in the central cluster) and a row CLAIMED by the central cluster's agent
 * (`LORE_CENTRAL_CLUSTER_AGENT_ID`). A satellite's CR is invisible to the central
 * read — it answers null, and acting on that null would double-launch.
 */
export function agentCrVisible(
  node: Pick<StationRunRecord, "status" | "clusterAgentId">,
  centralClusterAgentId: string | null,
): boolean {
  return (
    node.status === "running" ||
    (node.clusterAgentId !== null &&
      node.clusterAgentId === centralClusterAgentId)
  );
}
