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

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { InMemoryClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-memory.js";
import { mayClaim } from "@re-cinq/lore-shared/project/cluster-agents/capacity.js";
import { assemblyLineReaperJob } from "./assembly-run-reaper.js";
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

/** The central cluster's name in the harness registry. Its ID is whatever
 *  registration minted — resolved through the registry exactly as production
 *  does (`clusterAgents().findByName(...)`), because a second, hardcoded
 *  identity for the same cluster makes `agentCrVisible` judge central's own CRs
 *  unreadable, which is what a real claim through this harness first exposed. */
export const CENTRAL_CLUSTER_AGENT_NAME = "central";

/** The tag set cluster-agent-helm gives the central cluster — every node type,
 *  including the central-only ones a satellite never receives. */
export const CENTRAL_TAGS = [
  "node:agent",
  "node:validate",
  "node:gate",
  "node:retrospective",
  "node:github_action",
  "node:detect",
  "node:ingest",
  "node:comment-triage",
];

/** What the standalone installer defaults a satellite to (#1617). */
export const SATELLITE_TAGS = ["node:agent"];

export interface CompleteAgentNodeInput {
  /** Full scripted CR output (NDJSON envelope or plain text). Wins over `outcome`. */
  output?: string;
  /** The cluster-agent that claimed this node, defaulting to the central one.
   *  Name a SATELLITE to walk a node this Floor cannot interrogate. */
  claimedBy?: string;
  /** Script the CR read as unreadable — the terminal event arrives and
   *  `readAgentStatus` answers null, which is what a satellite's CR does. */
  statusUnreadable?: boolean;
  /** Report the status ON the terminal event itself (specs/running-stations-in-any-k8s-cluster
   *  FR4's follow-up) — what a cluster-agent that has adopted the fix sends.
   *  Combine with `statusUnreadable` to prove the reported status alone
   *  resolves a node this Floor could never read back, the exact case that
   *  stranded PR #1599's review. */
  reportStatus?: boolean;
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
  // The registry the claim reads. Two clusters by default, exactly as the fleet
  // is shaped: a central one carrying every tag and a satellite carrying only
  // `node:agent` — which is why one paused central starves a line rather than
  // failing over.
  const agents = new InMemoryClusterAgents();
  const agentIds = new Map<string, string>();
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

  /** Resolved through the registry, exactly as production does. Named once
   *  because the walk treats it as optional and the reaper requires it. */
  const centralClusterAgentId = async (): Promise<string | null> => {
    await ensureFleet();

    return agentIds.get(CENTRAL_CLUSTER_AGENT_NAME) ?? null;
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
    centralClusterAgentId,
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

  /** Register the default fleet once, lazily: central with every tag, a
   *  satellite with `node:agent` alone. */
  async function ensureFleet(): Promise<void> {
    if (agentIds.size > 0) {
      return;
    }

    for (const [name, tags] of [
      [CENTRAL_CLUSTER_AGENT_NAME, CENTRAL_TAGS],
      ["satellite", SATELLITE_TAGS],
    ] as const) {
      const created = await agents.create({
        name,
        tags: [...tags],
        tokenHash: `hash-${name}`,
        clusterInfo: null,
      });

      // A null create means the name was taken. Storing "" would hand every
      // later lookup an id that matches nothing — the claim would silently find
      // no work and the harness would report a walk that never happened.
      enforceTrue(
        created,
        Error,
        `acceptance harness: cluster agent "${name}" could not be registered`,
      );
      agentIds.set(name, created.id);
    }
  }

  /**
   * One cluster-agent polling for work — the REAL gate the route applies
   * (`mayClaim`) over the REAL queue scan (`claimNextStationRun`), rather than
   * a row mutated into place. Null is the 204 an agent backs off on, whether it
   * is paused or simply carries none of the node's tags.
   */
  async function claimAs(name: string) {
    await ensureFleet();
    const agent = await agents.findByName(name);

    if (!agent || !mayClaim(agent)) {
      return null;
    }

    return runs.claimNextStationRun({
      clusterAgentId: agent.id,
      tags: agent.tags,
    });
  }

  /** The operator's switch, as the Clusters page flips it. */
  async function pause(name: string): Promise<void> {
    await ensureFleet();
    const agent = await agents.findByName(name);

    if (agent) {
      await agents.setPaused(agent.id, true);
    }
  }

  async function unpause(name: string): Promise<void> {
    await ensureFleet();
    const agent = await agents.findByName(name);

    if (agent) {
      await agents.setPaused(agent.id, false);
    }
  }

  /**
   * The REAL reaper sweep, with the clock moved forward instead of slept
   * through. This is what turns a queued row nobody claimed into a terminal
   * failure, and it reads the same registry the claim does — so the reason it
   * writes names the cluster this harness actually paused.
   */
  async function reap(input: { minutesLater?: number } = {}): Promise<string> {
    await ensureFleet();
    const shifted = new Date(Date.now() + (input.minutesLater ?? 0) * 60_000);

    return assemblyLineReaperJob({
      ...deps,
      taskStatus: async () => null,
      centralClusterAgentId,
      listClusterAgents: () => agents.list(),
      now: () => shifted,
    });
  }

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
      await ensureFleet();
      claimed.clusterAgentId =
        input.claimedBy ?? agentIds.get(CENTRAL_CLUSTER_AGENT_NAME) ?? null;
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
      ...(input.reportStatus ? { status: { phase, output } } : {}),
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
    agents,
    enqueued,
    published,
    start,
    completeAgentNode,
    claimAs,
    pause,
    unpause,
    reap,
    resume,
    visits,
  };
}
