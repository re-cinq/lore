// Floor-side assembly-line driver — core (ADR-031 D4, #686 Wave 2). When the assembly line runs
// Floor-side, each agent-node dispatches its OWN Agent CR (the assembly line has several), and
// the github_action nodes gate on CI. This module is the pure/assembly core: the per-node
// dispatch spec + wiring the runner kernel's agent-node + github_action handlers to the
// Floor's ports. The IO shell (clone the branch for stage-commit state, run the
// supervisor, back the ports with real dispatch/poll/CI) lives in the driver entrypoint.

import {
  createStationNodeHandler,
  createProductionHandlers,
  type NodeHandler,
  type NodeHandlers,
  type AssemblyLineNode,
  type AgentNodeStatus,
  type CiConclusion,
  type ProductionHandlersDeps,
} from "@re-cinq/lore-assembly-lines";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import { stationName } from "../agent/agent-catalog.js";

export interface FloorAssemblyLineTask {
  taskId: string;
  /** The backing pipeline.tasks row id — null for task-less lines (code-review).
   *  Feeds the lease + audit + `Lore-Task:` trailer; a synthetic id there violates
   *  task_leases_task_fk. Token keying + CR labels use `taskId` instead. */
  pipelineTaskId: string | null;
  /** Per-attempt id (pipeline.assembly_lines) — CR names key on this, not the task. */
  assemblyLineId: string;
  taskType: string;
  description: string;
  targetRepo: string;
  branch: string;
}

/** Distinct Agent CR name per (attempt, node, ITERATION): two runs of one task never
 *  collide on a CR, and a REVISITED node (iteration>1) runs a fresh pod rather than
 *  409-reusing the prior iteration's terminal CR. Iteration 1 keeps the bare
 *  `<id8>-<nodeId>` form (back-compat); revisits append `-<iteration>`.
 *  The CR spec still carries the taskId — the watcher/reaper probe by task-id label. */
export function nodeAgentName(
  assemblyLineId: string,
  nodeId: string,
  iteration = 1,
): string {
  const base = `${assemblyLineId.substring(0, 8)}-${nodeId}`;

  return iteration > 1 ? `${base}-${iteration}` : base;
}

/** The CR name only carries an 8-char prefix; these labels carry the full identity
 *  so the k8s watch maps a terminal node CR back to its (line, node, iteration). */
export const ASSEMBLY_LINE_ID_LABEL = "lore.re-cinq.com/assembly-line-id";
export const NODE_ID_LABEL = "lore.re-cinq.com/node-id";
export const NODE_ITERATION_LABEL = "lore.re-cinq.com/node-iteration";

function nodeLabels(
  node: AssemblyLineNode,
  task: FloorAssemblyLineTask,
  iteration: number,
): Record<string, string> {
  return {
    [ASSEMBLY_LINE_ID_LABEL]: task.assemblyLineId,
    [NODE_ID_LABEL]: node.id,
    [NODE_ITERATION_LABEL]: String(iteration),
  };
}

/** Pure: the Agent dispatch spec for one agent-node. Prompt is resolved per node; model
 *  from the node (else inherited); repo/branch/description from the task. */
export function nodeAgentSpec(
  node: AssemblyLineNode,
  task: FloorAssemblyLineTask,
  prompt: string,
  iteration = 1,
): LoreTaskSpec {
  return {
    taskId: task.taskId,
    taskType: task.taskType,
    description: task.description,
    prompt,
    targetRepo: task.targetRepo,
    branch: task.branch,
    ...(node.model ? { model: node.model } : {}),
    name: nodeAgentName(task.assemblyLineId, node.id, iteration),
    extraLabels: nodeLabels(node, task, iteration),
  };
}

/** Node knobs a station receives as its `params` (everything execution-relevant
 *  the YAML can say about the node, minus the routing fields). */
const STATION_PARAM_FIELDS = [
  "validator",
  "job_ref",
  "condition_ref",
  "prompt_ref",
  "model",
] as const;

/** Pure: the Agent dispatch spec for one STATION node (validate/detect/…). The
 *  recipe's prompt template is literally `{station_input}`, so the whole node
 *  input rides one JSON parameter; the Station defaults to `def-<type>` unless
 *  the node names a custom one via `station_ref`. */
export function nodeStationSpec(
  node: AssemblyLineNode,
  task: FloorAssemblyLineTask,
  iteration = 1,
): LoreTaskSpec {
  const params: Record<string, string> = {};

  for (const field of STATION_PARAM_FIELDS) {
    const value = node[field];

    if (typeof value === "string" && value.length > 0) {
      params[field] = value;
    }
  }

  return {
    taskId: task.taskId,
    taskType: task.taskType,
    description: task.description,
    prompt: "",
    targetRepo: task.targetRepo,
    branch: task.branch,
    name: nodeAgentName(task.assemblyLineId, node.id, iteration),
    extraLabels: nodeLabels(node, task, iteration),
    stationRef: node.station_ref ?? stationName(node.type),
    parameters: {
      station_input: JSON.stringify({
        assembly_line_id: task.assemblyLineId,
        node_id: node.id,
        node_type: node.type,
        repo: task.targetRepo,
        branch: task.branch,
        task_id: task.taskId,
        params,
      }),
    },
  };
}

export interface FloorAssemblyLinePorts {
  /** Dispatch one node's Agent CR (e.g. AgentCrBackend.launch). */
  dispatchAgent: (spec: LoreTaskSpec) => Promise<void>;
  /** Resolve a node's prompt template for the task. */
  resolvePrompt: (
    node: AssemblyLineNode,
    task: FloorAssemblyLineTask,
  ) => string;
  /** Read this node's Agent status (keyed by assemblyLineId + node id). */
  agentStatus: (
    assemblyLineId: string,
    nodeId: string,
  ) => Promise<AgentNodeStatus | null>;
  /** Aggregate CI conclusion for the branch's head. */
  ciConclusion: (branch: string) => Promise<CiConclusion>;
  heartbeat: (branchName: string, nodeId: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  episodeDeps: ProductionHandlersDeps;
}

/** Assemble the NodeHandlers for a Floor-side run: EVERY node dispatches one Agent CR
 *  and polls it — agent nodes run an LLM, non-agent nodes ("stations": validate / gate /
 *  retrospective / github_action / detect) run the deterministic lore-station image via
 *  the exec vendor (ADR-031 amendment). No in-process node handlers remain on this path. */
export function buildFloorAssemblyLineHandlers(
  task: FloorAssemblyLineTask,
  ports: FloorAssemblyLinePorts,
): NodeHandlers {
  const station: NodeHandler = createStationNodeHandler({
    launch: (node) => ports.dispatchAgent(nodeStationSpec(node, task)),
    poll: ports.agentStatus,
    heartbeat: ports.heartbeat,
    sleep: ports.sleep,
  });

  return {
    ...createProductionHandlers({
      episodeDeps: ports.episodeDeps,
      agent: createStationNodeHandler({
        launch: (node) =>
          ports.dispatchAgent(
            nodeAgentSpec(node, task, ports.resolvePrompt(node, task)),
          ),
        poll: ports.agentStatus,
        heartbeat: ports.heartbeat,
        sleep: ports.sleep,
      }),
      validate: station,
      gate: station,
      retrospective: station,
      github_action: station,
    }),
    detect: station,
  };
}
