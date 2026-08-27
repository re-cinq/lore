// The acceptance harness: one real walk, no cluster.
//
// Wires the REAL start/node/resume handlers over the REAL builtin blueprints and
// the in-memory assembly-runs port, replacing exactly two things — the cluster
// (an enqueue recorder plus scripted CR statuses) and the human (a resume event).
// Everything between them is production code: the transition replay, the outcome
// parsing, the artifact delivery, the args channel. This is the composition
// layer the per-handler suites cannot see — the tier where the shallow
// args-merge (#1462) and the dead planning join (#1162) lived while every unit
// test stayed green.

import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  loadBuiltinAssemblyLines,
  type AgentNodeStatus,
} from "@re-cinq/lore-assembly-lines";
import {
  advanceLine,
  finishNodeAndAdvance,
  type AdvanceDeps,
} from "./advance.js";
import { createStartEventHandler } from "./start-event-handler.js";
import {
  createNodeEventHandler,
  type NodeEventDeps,
} from "./node-event-handler.js";
import { createResumeEventHandler } from "./resume-event-handler.js";
import { nodeAgentName } from "./floor-assembly-run.js";

export interface PublishedServiceNode {
  eventName: string;
  params: Record<string, unknown>;
  dedupeKey?: string;
}

/** The harness's stand-in for the central cluster's registered agent id. Every
 *  node claim is attributed to it unless a test names another cluster. */
export const CENTRAL_CLUSTER_AGENT_ID = "central-acceptance";

export interface CompleteAgentNodeInput {
  /** Full scripted CR output (NDJSON envelope or plain text). Wins over `outcome`. */
  output?: string;
  /** The cluster-agent that claimed this node, defaulting to the central one.
   *  Name a SATELLITE to walk a node this Floor cannot interrogate. */
  claimedBy?: string;
  /** Script the CR read as unreadable — the terminal event arrives and
   *  `readAgentStatus` answers null, which is what a satellite's CR does. */
  statusUnreadable?: boolean;
  /** Shorthand: emit a result envelope carrying `LORE_NODE_RESULT: {outcome}`. */
  outcome?: "success" | "changes_requested" | "failed";
  phase?: string;
  iteration?: number;
}

export interface StartLineInput {
  repo?: string;
  branch?: string;
  taskId?: string;
  args?: Record<string, unknown>;
}

/** A claude terminal-result envelope line, exactly as a pod's status carries it. */
export function resultEnvelope(agentText: string): string {
  return JSON.stringify({ type: "result", result: agentText });
}

/** An attributed file-artifact envelope line — the sink lane's shape. */
export function fileArtifactEnvelope(input: {
  taskId: string;
  agentName: string;
  event: string;
  path: string;
  content: string;
}): string {
  return JSON.stringify({
    source: { task: input.taskId, agent: input.agentName },
    event: {
      kind: "file",
      event: input.event,
      path: input.path,
      content: input.content,
    },
  });
}

export function createLineHarness(
  overrides: Partial<Pick<AdvanceDeps, "onRunClosed" | "stampPr">> = {},
) {
  const runs = new InMemoryAssemblyRuns();
  const enqueued: LoreTaskSpec[] = [];
  const published: PublishedServiceNode[] = [];
  const statusByAgent = new Map<string, AgentNodeStatus>();
  // The walk arms the queued row through the port; recording the specs here is
  // the harness's window on "what would a claiming cluster-agent be handed".
  const armDispatch = runs.enqueueStationRunDispatch.bind(runs);

  runs.enqueueStationRunDispatch = async (nodeRowId, dispatchSpec) => {
    enqueued.push(dispatchSpec as LoreTaskSpec);
    await armDispatch(nodeRowId, dispatchSpec);
  };

  const deps: NodeEventDeps = {
    assemblyRuns: runs,
    definitions: loadBuiltinAssemblyLines,
    repoSettings: async () => null,
    resolvePrompt: (promptRef, description) => `${promptRef}::${description}`,
    cleanupToken: async () => {},
    jobRuns: { complete: async () => {}, fail: async () => {} },
    publishNode: async (event) => {
      published.push(event);
    },
    readAgentStatus: async (name) => statusByAgent.get(name) ?? null,
    centralClusterAgentId: async () => CENTRAL_CLUSTER_AGENT_ID,
    ...overrides,
  };

  const startHandler = createStartEventHandler({
    assemblyRuns: runs,
    definitions: loadBuiltinAssemblyLines,
    advance: (id) => advanceLine(id, deps),
  });
  const nodeHandler = createNodeEventHandler(deps);
  const resumeHandler = createResumeEventHandler({
    assemblyRuns: runs,
    finishNodeAndAdvance: (input) => finishNodeAndAdvance(input, deps),
  });

  /** Persist the row and claim its start event — `assembly_run.start`, end to end. */
  async function start(
    blueprintName: string,
    input: StartLineInput = {},
  ): Promise<string> {
    const id = await runs.start({
      blueprintName,
      repo: input.repo ?? "re-cinq/lore",
      branch: input.branch ?? "lore/acceptance",
      taskId: input.taskId,
      args: { description: `acceptance: ${blueprintName}`, ...input.args },
    });

    await startHandler({ assemblyRunId: id, blueprintName });

    return id;
  }

  /** One node CR going terminal — `kubernetes.agent_node.*`, through the real door. */
  async function completeAgentNode(
    assemblyRunId: string,
    nodeId: string,
    input: CompleteAgentNodeInput = {},
  ): Promise<void> {
    const iteration = input.iteration ?? 1;
    const phase = input.phase ?? "Succeeded";
    const agentName = nodeAgentName(assemblyRunId, nodeId, iteration);
    const output =
      input.output ??
      resultEnvelope(
        `LORE_NODE_RESULT: {"outcome":"${input.outcome ?? "success"}"}`,
      );

    // A CR only exists because a cluster-agent CLAIMED the row and launched it,
    // so the row a terminal event arrives for is never still `queued`. Written
    // straight onto the row rather than through `claimNextStationRun`: the claim
    // scan takes the next queued row of any node, and a walk parks one node at a
    // time only by luck.
    const claimed = runs.nodes.find(
      (n) =>
        n.assemblyRunId === assemblyRunId &&
        n.nodeId === nodeId &&
        n.iteration === iteration &&
        n.outcome === null,
    );

    if (claimed && claimed.status === "queued") {
      claimed.status = "claimed";
      claimed.clusterAgentId = input.claimedBy ?? CENTRAL_CLUSTER_AGENT_ID;
      claimed.claimedAt = new Date();
    }

    if (!input.statusUnreadable) {
      statusByAgent.set(agentName, { phase, output });
    }
    await nodeHandler({
      assemblyRunId,
      nodeId,
      agentName,
      iteration,
      phase,
    });
  }

  /** A worker outside the pod system reporting — `assembly_line.resume`. */
  async function resume(
    assemblyRunId: string,
    nodeId: string,
    outcome: "success" | "changes_requested" | "failed",
    args?: Record<string, unknown>,
    iteration?: number,
  ): Promise<void> {
    await resumeHandler({
      assemblyRunId,
      nodeId,
      outcome,
      ...(args ? { args } : {}),
      ...(iteration === undefined ? {} : { iteration }),
    });
  }

  /** The visit trail as [nodeId, outcome] pairs, in row order. */
  function visits(): Array<[string, string | null]> {
    return runs.nodes.map((n) => [n.nodeId, n.outcome]);
  }

  return {
    runs,
    enqueued,
    published,
    start,
    completeAgentNode,
    resume,
    visits,
  };
}
