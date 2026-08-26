import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// The registered-clusters read (FR7 of specs/running-stations-in-any-k8s-cluster):
// every registered cluster-agent with its open-claim count, plus the recent
// `cluster_agent_offline` audit entries. Shapes are aliases over the generated
// OpenAPI document, same as every other module in this layer.

export type ClusterAgentList = components["schemas"]["ClusterAgentList"];

export type ClusterAgentRow = ClusterAgentList["agents"][number];

export type ClusterOfflineEvent = ClusterAgentList["offline_events"][number];

/** The full registered-clusters roster plus recent offline events. */
export function getClusterAgents(): Promise<ApiResult<ClusterAgentList>> {
  return apiFetch("lore-api", "/api/cluster-agents");
}
