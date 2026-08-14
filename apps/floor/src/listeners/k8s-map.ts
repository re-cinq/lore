/**
 * Pure Agent-CR → event mapping (layer 1). The k8s watch hands each observed CR
 * here; only terminal phases (Succeeded/Failed) produce an event, keyed on
 * task-id + phase so repeated MODIFIED notifications and re-list catch-ups
 * collapse to one row. No `@kubernetes/client-node` or `@re-cinq/agent-contracts`
 * import here — keeps the mapper unit-testable; the label is the CR contract.
 */

import type { EventInput } from "../main-loop/types.js";
import { k8sDedupeKey, k8sAgentNodeDedupeKey } from "../main-loop/dedupe.js";

/** Mirror of agent-watcher-logic's TASK_ID_LABEL (the AgentCrBackend sets it on every CR). */
const TASK_ID_LABEL = "lore.re-cinq.com/task-id";
/** Mirror of floor-assembly-line's labels: full line uuid + node id + iteration. */
const ASSEMBLY_RUN_ID_LABEL = "lore.re-cinq.com/assembly-run-id";
/** Pre-rename spelling — CRs from the previous image outlive a rollout, and one
 *  missed here becomes an assembly-line node the walk never advances past.
 *  DELETE once no CR predates the rename. */
const LEGACY_ASSEMBLY_LINE_ID_LABEL = "lore.re-cinq.com/assembly-line-id";
const NODE_ID_LABEL = "lore.re-cinq.com/node-id";
const NODE_ITERATION_LABEL = "lore.re-cinq.com/node-iteration";

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
  status?: { phase?: string };
}

export function mapAgentToEvent(agent: AgentLike): EventInput | null {
  const phase = agent.status?.phase;

  if (phase !== "Succeeded" && phase !== "Failed") {
    return null;
  }
  const labels = agent.metadata?.labels ?? {};
  const taskId = labels[TASK_ID_LABEL];

  if (!taskId) {
    return null;
  }
  const action = TERMINAL_ACTIONS[phase as TerminalPhase];
  const assemblyLineId =
    labels[ASSEMBLY_RUN_ID_LABEL] ?? labels[LEGACY_ASSEMBLY_LINE_ID_LABEL];
  const nodeId = labels[NODE_ID_LABEL];
  const iteration = Number(labels[NODE_ITERATION_LABEL] ?? "1");
  const agentName = agent.metadata?.name ?? null;

  // An assembly-line NODE CR: its own event family, deduped per CR name (all
  // node CRs of one line share the task-id label — a task-keyed dedupe would
  // swallow every node after the first). CR names embed the iteration, so the
  // per-name dedupe key is per-iteration; the iteration also rides the params so
  // the handler CASes the exact revisit's row. The transition handler consumes these.
  if (assemblyLineId && nodeId && agentName) {
    return {
      eventName: `kubernetes.agent_node.${action}`,
      source: "kubernetes",
      params: { assemblyLineId, nodeId, iteration, agentName, taskId, phase },
      dedupeKey: k8sAgentNodeDedupeKey(agentName, phase),
    };
  }

  return {
    eventName: `kubernetes.agent.${action}`,
    source: "kubernetes",
    params: { taskId, agentName, phase },
    dedupeKey: k8sDedupeKey(taskId, phase),
  };
}
