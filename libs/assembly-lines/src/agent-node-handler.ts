// Back-compat shim: the agent-node handler generalized into the station-node
// handler (one Agent CR per node for EVERY node type, ADR-031 D4 extended).
// Delete once all imports move to station-node-handler (Phase 4 cutover).

export {
  createAgentNodeHandler,
  agentNodeOutcome,
  parseReviewVerdict,
  type AgentNodeStatus,
  type AgentNodeDeps,
} from "./station-node-handler.js";
