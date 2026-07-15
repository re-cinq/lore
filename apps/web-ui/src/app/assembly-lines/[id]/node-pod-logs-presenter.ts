// Pure logic behind NodePodLogs — kept out of the component so it is directly
// testable. The Floor's /api/agent-logs response drives what the panel shows and
// whether it keeps polling.

export interface NodeLogsResponse {
  available: boolean;
  logs: string | null;
  phase: string | null;
  podName: string | null;
  reason?: string;
}

export function nodeLogsUrl(
  assemblyLineId: string,
  agentCrName: string,
): string {
  return `/api/assembly-lines/${assemblyLineId}/nodes/${encodeURIComponent(
    agentCrName,
  )}/logs`;
}

/** Poll only while the pod is live and running — stop once it is terminal or gone. */
export function shouldPollNode(resp: NodeLogsResponse | null): boolean {
  return resp !== null && resp.available && resp.phase === "Running";
}

export function unavailableMessage(reason?: string): string {
  switch (reason) {
    case "no-agent":
      return "No agent was launched for this node.";
    case "no-job":
      return "The node's pod hasn't started yet.";
    case "no-pod":
      return "Logs are no longer available — the pod was cleaned up.";
    default:
      return "Logs are not available for this node.";
  }
}
