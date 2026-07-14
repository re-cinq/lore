// Layer-3 handler for `kubernetes.agent_node.{succeeded,failed}` (spec 6-dark-factory
// FR6): one node CR went terminal → parse its outcome (LORE_NODE_RESULT /
// REVIEW_RESULT / phase precedence, reused from the station contract) → record it
// (CAS) → advance the line. The CR may already be pruned (terminal +1h) — the
// event's phase is the fallback, matching the poll path's no-output default.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  stationNodeOutcome,
  type AgentNodeStatus,
} from "@re-cinq/lore-assembly-lines";
import type { EventHandler } from "../../main-loop/types.js";
import {
  advanceLine,
  finishNodeAndAdvance,
  type AdvanceDeps,
} from "./advance.js";

export interface NodeEventDeps extends AdvanceDeps {
  /** Read the CR's status by name; null when it no longer exists (pruned). */
  readAgentStatus: (name: string) => Promise<AgentNodeStatus | null>;
}

export function createNodeEventHandler(deps: NodeEventDeps): EventHandler {
  return async (params) => {
    const assemblyLineId = String(params.assemblyLineId ?? "");
    const nodeId = String(params.nodeId ?? "");
    const agentName = String(params.agentName ?? "");

    enforceTrue(
      assemblyLineId.length > 0 && nodeId.length > 0 && agentName.length > 0,
      Error,
      "kubernetes.agent_node event params missing assemblyLineId/nodeId/agentName",
    );

    const row = await deps.assemblyLines.getById(assemblyLineId);

    if (!row || row.status !== "running") {
      return;
    }

    const definition = (await deps.definitions()).get(row.definitionName);
    const node = definition?.nodes.find((n) => n.id === nodeId);

    if (!definition || !node) {
      return;
    }

    const status = (await deps.readAgentStatus(agentName)) ?? {
      phase: String(params.phase ?? ""),
    };
    const result = stationNodeOutcome(node, status);

    await finishNodeAndAdvance({ assemblyLineId, nodeId, result }, deps);
  };
}

/** Re-exported for the start handler / reaper compositions. */
export { advanceLine };

/** Production deps, resolved lazily so importing the registry never forces the DB
 *  pool or the K8s client. Shared by the node-event handler, the start handler's
 *  advance, and the reaper tick. */
export async function productionNodeEventDeps(): Promise<NodeEventDeps> {
  const [
    { assemblyLines },
    { loadBuiltinAssemblyLines },
    { agentCrBackend },
    { buildPrompt },
    { cleanupPerTaskToken },
    { KubeAgentApi },
  ] = await Promise.all([
    import("../../kernel/queues.js"),
    import("@re-cinq/lore-assembly-lines"),
    import("../../composition/project-boot.js"),
    import("../../kernel/config.js"),
    import("../watcher/agent-watcher.js"),
    import("../station/kube-agent-api.js"),
  ]);
  const kubeApi = new KubeAgentApi();

  return {
    assemblyLines: assemblyLines(),
    definitions: loadBuiltinAssemblyLines,
    launch: async (spec) => {
      await agentCrBackend().launch(spec);
    },
    resolvePrompt: buildPrompt,
    cleanupToken: cleanupPerTaskToken,
    readAgentStatus: (name) => kubeApi.getStatus(name),
  };
}

/** Composed production handler for the registry (both node-terminal events). */
export const agentNodeTerminal: EventHandler = async (params) => {
  const handler = createNodeEventHandler(await productionNodeEventDeps());

  return handler(params);
};
