// Whether THIS Floor can interrogate a station run's Agent CR — extracted here (not the reaper) to avoid an import cycle, since it distinguishes "the agent produced nothing" from "we were never able to look", which share the same `null`.

import type { StationRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";

/** Only two rows qualify: a legacy `running` row, or one CLAIMED by the central cluster's agent — a satellite's CR answers null, and acting on that null would double-launch. */
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
