/** The central cluster-agent's identity: the one registered cluster whose Agent CRs this Floor may read directly (`agentCrVisible`); every other claimant is reached only through what it reports. */

import { clusterAgents } from "./queues.js";

const DEFAULT_CENTRAL_CLUSTER_AGENT_NAME = "central";

/** The central agent's registry name (`LORE_CENTRAL_CLUSTER_AGENT_NAME`). */
export function centralClusterAgentName(): string {
  return (
    process.env.LORE_CENTRAL_CLUSTER_AGENT_NAME ??
    DEFAULT_CENTRAL_CLUSTER_AGENT_NAME
  );
}

/** The central agent's registered id, or null before it has registered — resolved per call, since the id is minted at registration. */
export async function centralClusterAgentId(): Promise<string | null> {
  return (
    (await clusterAgents().findByName(centralClusterAgentName()))?.id ?? null
  );
}
