import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// Registered-clusters read (FR7 of specs/running-stations-in-any-k8s-cluster): every cluster-agent with its open-claim count plus recent offline events; shapes alias the generated OpenAPI document.
export type ClusterAgentList = components["schemas"]["ClusterAgentList"];

export type ClusterAgentRow = ClusterAgentList["agents"][number];

export type ClusterOfflineEvent = ClusterAgentList["offline_events"][number];

/** The full registered-clusters roster plus recent offline events. */
export function getClusterAgents(): Promise<ApiResult<ClusterAgentList>> {
  return apiFetch("lore-api", "/api/cluster-agents");
}

export type ClusterAgentPause = components["schemas"]["ClusterAgentPause"];

/** Takes a cluster out of rotation (or back in) — a paused agent keeps heartbeating and finishes what it holds, only passed over for new work. */
export function setClusterAgentPaused(
  id: string,
  paused: boolean,
): Promise<ApiResult<ClusterAgentPause>> {
  return apiFetch("lore-api", `/api/cluster-agents/${id}/paused`, {
    method: "PUT",
    body: { paused },
  });
}

export type ClusterAgentRestart = components["schemas"]["ClusterAgentRestart"];

/** Bounces the cluster-agent process to re-pull `latest`; only the central cluster is reachable, lore-api refuses any other id. */
export function restartClusterAgent(
  id: string,
): Promise<ApiResult<ClusterAgentRestart>> {
  return apiFetch("lore-api", `/api/cluster-agents/${id}/restart`, {
    method: "POST",
  });
}

export type ClusterInstallInfo =
  components["schemas"]["ClusterAgentInstallInfo"];

/** Connect-a-cluster panel data (#1572): central URLs + registration token, or why unavailable. Admin-scoped — the token rides in the response. */
export function getClusterInstallInfo(): Promise<
  ApiResult<ClusterInstallInfo>
> {
  return apiFetch("lore-api", "/api/cluster-agents/install-info");
}
