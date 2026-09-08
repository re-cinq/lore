import type { ClusterAgentsRepository } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-port.js";
import { hashAgentToken } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agent-token.js";
import type { ClusterAgent } from "@re-cinq/lore-shared/models/cluster-agent.js";

export type ClusterAgentRefusal = { code: 401 | 403; body: { error: string } };

/** The agent behind the bearer, or the refusal. The id in the path must match the token's own agent — a valid token for a DIFFERENT agent is a 403, not a 401, because the caller is authenticated and simply not this agent. */
export async function authenticateClusterAgent(
  agents: Pick<ClusterAgentsRepository, "findByTokenHash">,
  bearer: string | undefined,
  agentId: string,
): Promise<{ agent: ClusterAgent } | ClusterAgentRefusal> {
  if (!bearer) {
    return { code: 401, body: { error: "unauthorized" } };
  }

  const agent = await agents.findByTokenHash(hashAgentToken(bearer));

  if (!agent || agent.id !== agentId) {
    return { code: 403, body: { error: "forbidden" } };
  }

  return { agent };
}
