/**
 * Pure Agent-CR → event mapping (layer 1). The k8s watch hands each observed CR
 * here; only terminal phases (Succeeded/Failed) produce an event, keyed on
 * task-id + phase so repeated MODIFIED notifications and re-list catch-ups
 * collapse to one row. No `@kubernetes/client-node` or `@re-cinq/agent-contracts`
 * import here — keeps the mapper unit-testable; the label is the CR contract.
 */

import type { EventInput } from "../types.js";
import { k8sDedupeKey } from "../dedupe.js";

/** Mirror of agent-watcher-logic's TASK_ID_LABEL (the AgentBackend sets it on every CR). */
const TASK_ID_LABEL = "lore.re-cinq.com/task-id";

export interface AgentLike {
  metadata?: { name?: string; labels?: Record<string, string> };
  status?: { phase?: string };
}

export function mapAgentToEvent(agent: AgentLike): EventInput | null {
  const phase = agent.status?.phase;
  if (phase !== "Succeeded" && phase !== "Failed") return null;
  const taskId = agent.metadata?.labels?.[TASK_ID_LABEL];
  if (!taskId) return null;
  const action = phase === "Succeeded" ? "succeeded" : "failed";
  return {
    eventName: `kubernetes.agent.${action}`,
    source: "kubernetes",
    params: { taskId, agentName: agent.metadata?.name ?? null, phase },
    dedupeKey: k8sDedupeKey(taskId, phase),
  };
}
