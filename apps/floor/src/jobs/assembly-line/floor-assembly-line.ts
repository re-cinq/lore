// Floor-side assembly-line driver — core (ADR-031 D4, #686 Wave 2). When the assembly line runs
// Floor-side, each agent-node dispatches its OWN Agent CR (the assembly line has several), and
// the github_action nodes gate on CI. This module is the pure/assembly core: the per-node
// dispatch spec + wiring the runner kernel's agent-node + github_action handlers to the
// Floor's ports. The IO shell (clone the branch for stage-commit state, run the
// supervisor, back the ports with real dispatch/poll/CI) lives in the driver entrypoint.

import {
  createStationNodeHandler,
  createGithubActionHandler,
  createProductionHandlers,
  type NodeHandler,
  type NodeHandlers,
  type AssemblyLineNode,
  type AgentNodeStatus,
  type CiConclusion,
  type ProductionHandlersDeps,
} from "@re-cinq/lore-assembly-lines";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";

export interface FloorAssemblyLineTask {
  taskId: string;
  /** Per-attempt id (pipeline.assembly_lines) — CR names key on this, not the task. */
  assemblyLineId: string;
  taskType: string;
  description: string;
  targetRepo: string;
  branch: string;
}

/** Distinct Agent CR name per (attempt, node): two runs of one task never collide on a CR.
 *  The CR spec still carries the taskId — the watcher/reaper probe by task-id label. */
export function nodeAgentName(assemblyLineId: string, nodeId: string): string {
  return `${assemblyLineId.substring(0, 8)}-${nodeId}`;
}

/** Pure: the Agent dispatch spec for one agent-node. Prompt is resolved per node; model
 *  from the node (else inherited); repo/branch/description from the task. */
export function nodeAgentSpec(
  node: AssemblyLineNode,
  task: FloorAssemblyLineTask,
  prompt: string,
): LoreTaskSpec {
  return {
    taskId: task.taskId,
    taskType: task.taskType,
    description: task.description,
    prompt,
    targetRepo: task.targetRepo,
    branch: task.branch,
    ...(node.model ? { model: node.model } : {}),
    name: nodeAgentName(task.assemblyLineId, node.id),
  };
}

/** Node knobs a station receives as its `params` (everything execution-relevant
 *  the YAML can say about the node, minus the routing fields). */
const STATION_PARAM_FIELDS = ["validator", "job_ref", "condition_ref", "prompt_ref", "model"] as const;

/** Pure: the Agent dispatch spec for one STATION node (validate/detect/…). The
 *  recipe's prompt template is literally `{station_input}`, so the whole node
 *  input rides one JSON parameter; the Station defaults to `def-<type>` unless
 *  the node names a custom one via `station_ref`. */
export function nodeStationSpec(node: AssemblyLineNode, task: FloorAssemblyLineTask): LoreTaskSpec {
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
    name: nodeAgentName(task.assemblyLineId, node.id),
    stationRef: node.station_ref ?? `def-${node.type}`,
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

/** The LORE_STATION_NODES cutover flag: node types that dispatch station pods
 *  instead of running in-process. Temporary — deleted when the cutover completes. */
export function stationNodesFromEnv(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
  );
}

export interface FloorAssemblyLinePorts {
  /** Dispatch one node's Agent CR (e.g. AgentCrBackend.launch). */
  dispatchAgent: (spec: LoreTaskSpec) => Promise<void>;
  /** Resolve a node's prompt template for the task. */
  resolvePrompt: (node: AssemblyLineNode, task: FloorAssemblyLineTask) => string;
  /** Read this node's Agent status (keyed by assemblyLineId + node id). */
  agentStatus: (assemblyLineId: string, nodeId: string) => Promise<AgentNodeStatus | null>;
  /** Aggregate CI conclusion for the branch's head. */
  ciConclusion: (branch: string) => Promise<CiConclusion>;
  heartbeat: (branchName: string, nodeId: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  episodeDeps: ProductionHandlersDeps;
}

/** Assemble the NodeHandlers for a Floor-side run: the agent slot dispatches one Agent CR
 *  per node and polls it; the github_action slot gates on CI. Node types listed in
 *  `stationNodes` (the LORE_STATION_NODES cutover flag) dispatch a station pod the same
 *  way instead of running the in-process kernel defaults. */
export function buildFloorAssemblyLineHandlers(
  task: FloorAssemblyLineTask,
  ports: FloorAssemblyLinePorts,
  stationNodes: ReadonlySet<string> = new Set(),
): NodeHandlers {
  const stationHandler: NodeHandler = createStationNodeHandler({
    launch: (node) => ports.dispatchAgent(nodeStationSpec(node, task)),
    poll: ports.agentStatus,
    heartbeat: ports.heartbeat,
    sleep: ports.sleep,
  });
  const stationOr = (type: string, inProcess?: NodeHandler): NodeHandler | undefined =>
    stationNodes.has(type) ? stationHandler : inProcess;

  const handlers = createProductionHandlers({
    episodeDeps: ports.episodeDeps,
    agent: createStationNodeHandler({
      launch: (node) =>
        ports.dispatchAgent(nodeAgentSpec(node, task, ports.resolvePrompt(node, task))),
      poll: ports.agentStatus,
      heartbeat: ports.heartbeat,
      sleep: ports.sleep,
    }),
    validate: stationOr("validate"),
    gate: stationOr("gate"),
    retrospective: stationOr("retrospective"),
    github_action: stationOr(
      "github_action",
      createGithubActionHandler({
        ciConclusion: ports.ciConclusion,
        heartbeat: ports.heartbeat,
        sleep: ports.sleep,
      }),
    ),
  });
  const detect = stationOr("detect");
  return detect ? { ...handlers, detect } : handlers;
}
