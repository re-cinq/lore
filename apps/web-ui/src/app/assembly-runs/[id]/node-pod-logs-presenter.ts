// Pure logic behind NodeLogPanel, kept out of the component so it is directly testable; driven by the Floor's /api/agent-logs response.
export interface NodeLogsResponse {
  available: boolean;
  logs: string | null;
  phase: string | null;
  podName: string | null;
  reason?: string;
  // true when logs were read back from the durable archive (Cloud Logging) because the live pod was already cleaned up.
  archived?: boolean;
}

export function nodeLogsUrl(
  assemblyLineId: string,
  agentCrName: string,
): string {
  return `/api/assembly-runs/${assemblyLineId}/nodes/${encodeURIComponent(
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
