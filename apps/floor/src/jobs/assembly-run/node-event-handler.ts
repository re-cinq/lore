// Layer-3 handler for `kubernetes.agent_node.{succeeded,failed}` (FR6): parse outcome, record (CAS), advance the line. Since FR4's follow-up the event may already carry the CR's status (`params.status`, from cluster-agent); only an older cluster-agent's event falls through to the central read + reaper handoff.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  stationNodeOutcome,
  type AgentNodeStatus,
} from "@re-cinq/lore-assembly-lines";
import { resolveRunGraph } from "@re-cinq/lore-assembly-lines";
import type { EventHandler } from "../../main-loop/types.js";
import { advanceLine } from "./advance-line.js";
import type { AdvanceDeps } from "./advance-deps.js";
import { finishNodeTerminal, normalizeAgentStatus } from "./node-terminal.js";
import { isDeliveringRecipe } from "@re-cinq/lore-shared/task-types/delivering-recipes.js";
import { agentCrVisible } from "./cr-visibility.js";
import { artifactsFromTerminalOutput } from "../agent/artifact-args.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import { isRecord } from "@re-cinq/lore-shared/lib/is-record.js";

export {
  productionNodeEventDeps,
  agentNodeTerminal,
} from "./node-event-deps.js";

export interface NodeEventDeps extends AdvanceDeps {
  /** Null means pruned OR unreachable-cluster — two different facts wearing the same null; {@link agentCrVisible} tells them apart. */
  readAgentStatus: (name: string) => Promise<AgentNodeStatus | null>;
  /** How much a DELIVERING node's branch differs from default; zero turns reported success into a failure. Optional seam — absent trusts the node's own word (pre-2026-08-30 behaviour). */
  deliveredChangeCount?: (repo: string, branch: string) => Promise<number>;
  /** The central cluster's registered agent id, resolved per call (minted at registration). Omitted/null leaves only legacy `running` rows visible (pre-claim-path behaviour). */
  centralClusterAgentId?: () => Promise<string | null>;
  /** Throttled operator alert when a CR failed because the Anthropic account ran dry; best-effort, optional. */
  alertBilling?: (
    repo: string,
    nodeType: string,
    status: AgentNodeStatus,
  ) => Promise<void>;
  /** Throttled operator alert when an AgentDefinition's skills_source was unreachable, stranding every Claude-agent node the affected cluster claims; best-effort, optional. */
  alertAgentConfig?: (
    repo: string,
    nodeType: string,
    status: AgentNodeStatus,
  ) => Promise<void>;
}

/** The event's own reported status (FR4's follow-up), or null when an older cluster-agent sent none; narrowed defensively since `params` is untyped JSONB off the wire. */
export function reportedStatus(status: unknown): AgentNodeStatus | null {
  if (!isRecord(status)) {
    return null;
  }

  return {
    ...(typeof status.phase === "string" ? { phase: status.phase } : {}),
    ...(typeof status.output === "string" ? { output: status.output } : {}),
    ...(typeof status.failureReason === "string"
      ? { failureReason: status.failureReason }
      : {}),
  };
}

/** The event's raw terminal status, or null when the CR was claimed by a cluster this Floor cannot read (left open for the reaper instead of fabricating an outcome). */
async function resolveRawStatus(
  event: NodeEvent,
  params: Record<string, unknown>,
  deps: NodeEventDeps,
): Promise<AgentNodeStatus | null> {
  const reported = reportedStatus(params.status);

  // Only an older cluster-agent's event (no status) needs a cluster interrogated; an unreachable CR would otherwise read as "agent produced nothing" (2026-08-27 regression).
  if (reported === null && (await claimUnreadableFromThisFloor(event, deps))) {
    return null;
  }

  // Unwrap the NDJSON envelope once: every text parser below must read the agent text, not the stream carrying it.
  return (
    reported ??
    (await deps.readAgentStatus(event.agentName)) ?? {
      phase: String(params.phase ?? ""),
    }
  );
}

export function createNodeEventHandler(deps: NodeEventDeps): EventHandler {
  return async (params) => {
    const event = readNodeEvent(params);
    const target = await resolveEventTarget(event, deps);

    if (!target) {
      return;
    }
    const rawStatus = await resolveRawStatus(event, params, deps);

    if (!rawStatus) {
      return;
    }
    const status = normalizeAgentStatus(rawStatus);
    // Merged BEFORE the walk moves — the artifact sink is a separate racing HTTP post, so without this the next station could miss an arg its predecessor already produced (a re-merge is a no-op).
    const result = await deliverTerminalArtifacts(
      target.row,
      target.node,
      rawStatus,
      deps,
    );

    await alertOnFailure(target, result, status, deps);
    tripGateOnAccountOutage(result, deps);

    await finishNodeTerminal(
      {
        row: target.row,
        node: target.node,
        nodeId: event.nodeId,
        iteration: event.iteration,
        result,
        output: status.output,
      },
      deps,
    );
  };
}

/** The three ids every agent_node event must carry, plus which visit it reports. */
interface NodeEvent {
  assemblyLineId: string;
  nodeId: string;
  agentName: string;
  iteration: number | undefined;
}

function readNodeEvent(params: Record<string, unknown>): NodeEvent {
  // A JSON null is as absent as a missing key: stringifying it would produce the literal "null" and pass the emptiness check below.
  const text = (value: unknown): string =>
    value === undefined || value === null ? "" : String(value);
  const event = {
    assemblyLineId: text(params.assemblyRunId) || text(params.assemblyLineId),
    nodeId: text(params.nodeId),
    agentName: text(params.agentName),
    iteration:
      typeof params.iteration === "number" ? params.iteration : undefined,
  };

  enforceTrue(
    event.assemblyLineId.length > 0 &&
      event.nodeId.length > 0 &&
      event.agentName.length > 0,
    Error,
    "kubernetes.agent_node event params missing assemblyLineId/nodeId/agentName",
  );

  return event;
}

/** The run and node the event is about, or null when there is nothing to advance — the run is gone or finished, or its graph no longer has that node. */
async function resolveEventTarget(
  event: NodeEvent,
  deps: NodeEventDeps,
): Promise<{ row: AssemblyRunRecord; node: RunGraphNode } | null> {
  const row = await deps.assemblyRuns.getById(event.assemblyLineId);

  if (!row || row.status !== "running") {
    return null;
  }
  const graph = await resolveRunGraph(row, deps.definitions);
  const node = graph?.nodes.find((n) => n.id === event.nodeId);

  return node ? { row, node } : null;
}

/** An account-out-of-credits failure downs every LLM node at once, and a missing skills_source strands every Claude-agent node on the CLUSTER — both are surfaced once to operators, ahead of the per-line failure notice. */
async function alertOnFailure(
  target: { row: AssemblyRunRecord; node: RunGraphNode },
  result: { outcome: string },
  status: ReturnType<typeof normalizeAgentStatus>,
  deps: NodeEventDeps,
): Promise<void> {
  if (result.outcome !== "failed") {
    return;
  }

  if (deps.alertBilling) {
    await deps.alertBilling(target.row.repo, target.node.type, status);
  }

  if (deps.alertAgentConfig) {
    await deps.alertAgentConfig(target.row.repo, target.node.type, status);
  }
}

/** True when the terminal CR was claimed by a cluster this Floor cannot read — the node stays open for the cluster-aware reaper rather than fabricating an outcome. */
async function claimUnreadableFromThisFloor(
  params: {
    assemblyLineId: string;
    nodeId: string;
    iteration: number | undefined;
    agentName: string;
  },
  deps: NodeEventDeps,
): Promise<boolean> {
  const { assemblyLineId, nodeId, iteration, agentName } = params;
  const openRow = (
    await deps.assemblyRuns.listStationRuns(assemblyLineId)
  ).find(
    (row) =>
      row.nodeId === nodeId &&
      row.outcome === null &&
      (iteration === undefined || row.iteration === iteration),
  );
  const centralClusterAgentId = (await deps.centralClusterAgentId?.()) ?? null;

  if (!openRow || agentCrVisible(openRow, centralClusterAgentId)) {
    return false;
  }
  console.warn(
    `[assembly-run] ${assemblyLineId} node ${nodeId}: terminal status unreadable — ` +
      `the Agent CR ${agentName} was claimed by cluster ${openRow.clusterAgentId ?? "(none)"}, ` +
      `which this Floor cannot read; leaving the node open for the reaper`,
  );

  return true;
}

/** Merges declared artifacts then decides outcome; shared by both terminal doors (node event + reaper resolve) since a dropped event means only one will ever see this output. A declared-but-unproduced artifact FAILS the node — else the next station reads an empty bag as "predecessor decided nothing." */
export async function deliverTerminalArtifacts(
  row: AssemblyRunRecord,
  node: { type: string; prompt_ref?: string | null },
  rawStatus: AgentNodeStatus,
  deps: Pick<AdvanceDeps, "assemblyRuns"> &
    Pick<NodeEventDeps, "deliveredChangeCount">,
): Promise<NodeResult> {
  const { args, missing } = artifactsFromTerminalOutput(rawStatus.output);

  if (Object.keys(args).length > 0) {
    await deps.assemblyRuns.mergeArgs(row.id, args);
  }
  const result = stationNodeOutcome(node, normalizeAgentStatus(rawStatus));

  if (result.outcome === "failed") {
    return result;
  }

  if (missing.length > 0) {
    return undelivered(`declared artifact not produced: ${missing.join(", ")}`);
  }

  // A DELIVERING node that left the branch empty is not a success, whatever it printed — caught here rather than at push, since the next pod's fresh-clone validate would otherwise lint the whole tree for nothing (18/18 impl-loop branches, 2026-08-30). Retryable via the self-retry edge.
  return (await emptyDeliveryFailure(row, node, deps)) ?? result;
}

async function emptyDeliveryFailure(
  row: AssemblyRunRecord,
  node: { type: string; prompt_ref?: string | null },
  deps: Pick<NodeEventDeps, "deliveredChangeCount">,
): Promise<NodeResult | null> {
  if (
    !isDeliveringRecipe(node.prompt_ref) ||
    !deps.deliveredChangeCount ||
    !row.branch
  ) {
    return null;
  }
  const changed = await deps.deliveredChangeCount(row.repo, row.branch);

  if (changed !== 0) {
    return null;
  }

  return undelivered(
    `the ${node.prompt_ref} node reported success but pushed nothing — ${row.branch} has no changes against the default branch`,
  );
}

const undelivered = (detail: string): NodeResult => ({
  outcome: "failed",
  failureClass: "unknown",
  failureDetail: detail,
  extras: { "Lore-Validation-Summary": detail },
});

/** Stops dispatching agent nodes when this failure says the account (not the run) is down; logged only on the transition, so an outage produces one event, not one per drowned run. */
function tripGateOnAccountOutage(
  result: NodeResult,
  deps: NodeEventDeps,
): void {
  if (!result.failureClass) {
    return;
  }

  if (deps.llmGate?.trip(result.failureClass, result.failureDetail)) {
    console.warn(
      `[llm-dispatch-gate] pausing agent dispatch: ${result.failureDetail ?? result.failureClass}`,
    );
  }
}

/** Re-exported for the start handler / reaper compositions. */
export { advanceLine };
