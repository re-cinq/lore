/** Agent CR → event mapping: terminal phases only, keyed per CR name/task; status passthrough avoids re-fetch. */

import type { EventInsert } from "../../events.js";
import { k8sDedupeKey, k8sAgentNodeDedupeKey } from "./dedupe.js";
import {
  ASSEMBLY_RUN_ID_LABEL,
  LEGACY_ASSEMBLY_LINE_ID_LABEL,
  NODE_ID_LABEL,
  NODE_ITERATION_LABEL,
  TASK_ID_LABEL,
} from "./agent-cr-labels.js";

/** The terminal CR phases that produce an event, mapped to their event action. */
const TERMINAL_ACTIONS = { Succeeded: "succeeded", Failed: "failed" } as const;

type TerminalPhase = keyof typeof TERMINAL_ACTIONS;

/** Every event name this mapper can produce (the registry must cover each). */
export const AGENT_EVENT_NAMES: string[] = Object.values(
  TERMINAL_ACTIONS,
).flatMap((action) => [
  `kubernetes.agent.${action}`,
  `kubernetes.agent_node.${action}`,
]);

export interface AgentLike {
  metadata?: { name?: string; labels?: Record<string, string> };
  status?: { phase?: string; output?: string; failureReason?: string };
}

interface TerminalAgentPhase {
  phase: TerminalPhase;
  taskId: string;
  labels: Record<string, string>;
}

function agentLabels(agent: AgentLike): Record<string, string> {
  return agent.metadata?.labels ?? {};
}

function terminalAgentPhase(agent: AgentLike): TerminalAgentPhase | null {
  const phase = agent.status?.phase;

  if (phase !== "Succeeded" && phase !== "Failed") {
    return null;
  }
  const labels = agentLabels(agent);
  const taskId = labels[TASK_ID_LABEL];

  if (!taskId) {
    return null;
  }

  return { phase, taskId, labels };
}

/** Full status the watch holds: passthrough so consumer never re-fetches. */
function agentStatus(agent: AgentLike, phase: TerminalPhase) {
  return {
    phase,
    output: agent.status?.output,
    failureReason: agent.status?.failureReason,
  };
}

function assemblyNodeIdentity(labels: Record<string, string>) {
  return {
    assemblyLineId:
      labels[ASSEMBLY_RUN_ID_LABEL] ?? labels[LEGACY_ASSEMBLY_LINE_ID_LABEL],
    nodeId: labels[NODE_ID_LABEL],
    iteration: Number(labels[NODE_ITERATION_LABEL] ?? "1"),
  };
}

function isAssemblyNodeEvent(
  assemblyLineId: string | undefined,
  nodeId: string | undefined,
  agentName: string | null,
): agentName is string {
  return Boolean(assemblyLineId && nodeId && agentName);
}

export function mapAgentToEvent(agent: AgentLike): EventInsert | null {
  const terminal = terminalAgentPhase(agent);

  if (!terminal) {
    return null;
  }
  const { phase, taskId, labels } = terminal;
  const action = TERMINAL_ACTIONS[phase];
  const { assemblyLineId, nodeId, iteration } = assemblyNodeIdentity(labels);
  const agentName = agent.metadata?.name ?? null;
  const status = agentStatus(agent, phase);

  // Assembly-line NODE CR: own event family, deduped per CR name (task-keyed dedupe swallows later nodes).
  if (isAssemblyNodeEvent(assemblyLineId, nodeId, agentName)) {
    return {
      eventName: `kubernetes.agent_node.${action}`,
      source: "kubernetes",
      params: {
        assemblyLineId,
        nodeId,
        iteration,
        agentName,
        taskId,
        phase,
        status,
      },
      dedupeKey: k8sAgentNodeDedupeKey(agentName, phase),
    };
  }

  return {
    eventName: `kubernetes.agent.${action}`,
    source: "kubernetes",
    params: { taskId, agentName, phase, status },
    dedupeKey: k8sDedupeKey(taskId, phase),
  };
}
