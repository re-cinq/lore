// Floor-side assembly-line driver — core (ADR-031 D4, #686 Wave 2). When the assembly line runs
// Floor-side, each agent-node dispatches its OWN Agent CR (the workflow has several), and
// the github_action nodes gate on CI. This module is the pure/assembly core: the per-node
// dispatch spec + wiring the runner kernel's agent-node + github_action handlers to the
// Floor's ports. The IO shell (clone the branch for stage-commit state, run the
// supervisor, back the ports with real dispatch/poll/CI) lives in the driver entrypoint.

import {
  createAgentNodeHandler,
  createGithubActionHandler,
  createProductionHandlers,
  type NodeHandlers,
  type WorkflowNode,
  type AgentNodeStatus,
  type CiConclusion,
  type ProductionHandlersDeps,
} from "@re-cinq/lore-runner";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";

export interface FloorAssemblyLineTask {
  taskId: string;
  taskType: string;
  description: string;
  targetRepo: string;
  branch: string;
}

/** Distinct Agent CR name per agent-node, so a task's nodes don't collide on one CR. */
export function nodeAgentName(taskId: string, nodeId: string): string {
  return `${taskId.substring(0, 8)}-${nodeId}`;
}

/** Pure: the Agent dispatch spec for one agent-node. Prompt is resolved per node; model
 *  from the node (else inherited); repo/branch/description from the task. */
export function nodeAgentSpec(
  node: WorkflowNode,
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
    name: nodeAgentName(task.taskId, node.id),
  };
}

export interface FloorAssemblyLinePorts {
  /** Dispatch one node's Agent CR (e.g. AgentCrBackend.launch). */
  dispatchAgent: (spec: LoreTaskSpec) => Promise<void>;
  /** Resolve a node's prompt template for the task. */
  resolvePrompt: (node: WorkflowNode, task: FloorAssemblyLineTask) => string;
  /** Read this node's Agent status (keyed by node id). */
  agentStatus: (taskId: string, nodeId: string) => Promise<AgentNodeStatus | null>;
  /** Aggregate CI conclusion for the branch's head. */
  ciConclusion: (branch: string) => Promise<CiConclusion>;
  heartbeat: (branchName: string, nodeId: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  episodeDeps: ProductionHandlersDeps;
}

/** Assemble the NodeHandlers for a Floor-side run: the agent slot dispatches one Agent CR
 *  per node and polls it; the github_action slot gates on CI; validate/gate/retrospective
 *  keep the kernel defaults. */
export function buildFloorAssemblyLineHandlers(
  task: FloorAssemblyLineTask,
  ports: FloorAssemblyLinePorts,
): NodeHandlers {
  return createProductionHandlers({
    episodeDeps: ports.episodeDeps,
    agent: createAgentNodeHandler({
      launch: (node) =>
        ports.dispatchAgent(nodeAgentSpec(node, task, ports.resolvePrompt(node, task))),
      poll: ports.agentStatus,
      heartbeat: ports.heartbeat,
      sleep: ports.sleep,
    }),
    github_action: createGithubActionHandler({
      ciConclusion: ports.ciConclusion,
      heartbeat: ports.heartbeat,
      sleep: ports.sleep,
    }),
  });
}
