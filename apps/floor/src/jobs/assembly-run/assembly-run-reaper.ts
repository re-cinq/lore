// The event-driven walk's liveness bound (spec 6-dark-factory FR6): sweeps dropped/dead-lettered transitions and stalled queue/claim/timeout states every minute for both graph and single-CR runs; never owns a claimed single-CR's execution timeout — the watcher settles that from the terminal event.

import { nodeTimeoutMinutes, stationBudgetFor } from "./node-timeout.js";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import {
  capacityFor,
  unclaimedDetail,
} from "@re-cinq/lore-shared/project/cluster-agents/capacity.js";
import type { ClusterAgent } from "@re-cinq/lore-shared/models/cluster-agent.js";
import {
  isHumanStation,
  type AgentNodeStatus,
} from "@re-cinq/lore-assembly-lines";
import { resolveRunGraph } from "@re-cinq/lore-assembly-lines";
import type {
  AssemblyRunRecord,
  StationRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { advanceLine, finishLine } from "./advance.js";
import { agentCrVisible } from "./cr-visibility.js";
import { finishNodeTerminal, normalizeAgentStatus } from "./node-terminal.js";
import {
  runOutcomeFromTaskStatus,
  stationOutcomeForRunOutcome,
} from "../watcher/agent-watcher-logic.js";
import {
  deliverTerminalArtifacts,
  type NodeEventDeps,
} from "./node-event-handler.js";

/** Reaper deps: the walk deps plus the backing-task status read used to sweep a crash-orphaned single-CR (definition-less) run row. */
export interface AssemblyLineReaperDeps extends NodeEventDeps {
  taskStatus: (taskId: string) => Promise<string | null>;
  /** FR4's offline sweep: marks agents silent past the threshold offline; optional, sweeps nothing without a registry. */
  offlineClusterAgents?: (cutoff: Date) => Promise<Set<string>>;
  /** The audit writer for `cluster_agent_offline` requeues. */
  audit?: (entry: {
    event_type: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
  /** The central cluster's registered agent id, for {@link agentCrVisible}; null (unregistered) leaves only legacy `running` rows visible. */
  centralClusterAgentId: () => Promise<string | null>;
  /** The registry, read once per sweep so a queue-timeout can say WHY nobody claimed the row (absent/paused/offline/ignoring); optional. */
  listClusterAgents?: () => Promise<ClusterAgent[]>;
  /** The sweep's clock. Injected so a test can age a queue without sleeping. */
  now?: () => Date;
  /** The queue-wait bound, defaulting to {@link stationQueueWaitMs}. */
  queueWaitMs?: number;
}

const DEFAULT_CENTRAL_CLUSTER_AGENT_NAME = "central";

/** The central agent's registry name (`LORE_CENTRAL_CLUSTER_AGENT_NAME`). */
export function centralClusterAgentName(): string {
  return (
    process.env.LORE_CENTRAL_CLUSTER_AGENT_NAME ??
    DEFAULT_CENTRAL_CLUSTER_AGENT_NAME
  );
}

const MINUTE_MS = 60_000;
/** Parity with the old poll loop's ~1h default (DEFAULT_MAX_POLLS) . */
const DEFAULT_TIMEOUT_MINUTES = 60;
const TIMEOUT_BUFFER_MINUTES = 2;
const QUEUED_LIMIT_MINUTES = 30;
/** Grace before an absent CR is trusted to mean "crashed before launch" — the row is written before the CR create, so a tick can race an in-flight provision (mirrors the planning reaper's FR-10.4 grace). */
const NODE_STARTUP_GRACE_MS = 2 * MINUTE_MS;
/** How long a `queued` row may wait for a claim before it fails terminally. */
const DEFAULT_QUEUE_WAIT_MINUTES = 30;

/** Silence past this marks a cluster-agent offline — ten missed 30s beats. */
export const OFFLINE_THRESHOLD_MS = 5 * MINUTE_MS;

/** The queue-wait bound (`LORE_STATION_QUEUE_WAIT_MINUTES`, default 30m). */
export function stationQueueWaitMs(): number {
  const minutes = Number(process.env.LORE_STATION_QUEUE_WAIT_MINUTES);

  return (minutes > 0 ? minutes : DEFAULT_QUEUE_WAIT_MINUTES) * MINUTE_MS;
}

export type NodeRecovery =
  | { kind: "resolve"; status: AgentNodeStatus }
  | { kind: "requeue" }
  | { kind: "requeue-offline" }
  | { kind: "timeout" }
  | { kind: "queue-timeout" }
  | { kind: "wait" };

/** Pure per-open-node decision from the node row's lifecycle status, its age on the claim clock, and — only when visible — the CR's live status. */
export function decideNodeRecovery(input: {
  node: StationRunRecord;
  timeoutMinutes: number | undefined;
  /** The CR's live status; the sweep reads it only for {@link agentCrVisible} rows, else passes null without asking the cluster. */
  status: AgentNodeStatus | null;
  /** The definition's node type. `wait` nodes have no budget — see below. */
  nodeType?: string;
  /** Precomputed {@link agentCrVisible} — whether null `status` means "the CR is gone" rather than "we never looked". */
  crVisible: boolean;
  /** The claiming cluster-agent is marked `offline` (FR4): its claim is lost, not stuck, so it requeues without any timeout precondition. */
  claimantOffline?: boolean;
  queueWaitMs: number;
  nowMs: number;
}): NodeRecovery {
  // A node whose worker is a HUMAN is never stuck, it is parked — "how long may a person take to answer" has no defensible number, so no budget applies at all.
  if (isHumanStation(input.nodeType)) {
    return { kind: "wait" };
  }

  // A `queued` row has no CR/claimant to interrogate; past the queue wait it fails terminally naming its tags.
  if (input.node.status === "queued") {
    return input.nowMs - input.node.startedAt.getTime() > input.queueWaitMs
      ? { kind: "queue-timeout" }
      : { kind: "wait" };
  }

  // A claim held by a DEAD cluster requeues immediately — the 5-minute offline threshold already absorbed transient silence.
  if (input.node.status === "claimed" && input.claimantOffline) {
    return { kind: "requeue-offline" };
  }
  const budgetMs =
    ((input.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES) +
      TIMEOUT_BUFFER_MINUTES) *
    MINUTE_MS;
  // A claimed row's budget runs from the claim so queue-wait time isn't charged against execution; pre-flip `running` rows have no claimedAt and measure from startedAt.
  const executionStartMs = (
    input.node.claimedAt ?? input.node.startedAt
  ).getTime();
  const expired = input.nowMs - executionStartMs > budgetMs;

  // A row claimed by a SATELLITE: its CR can't be read from here, so its only signal is the budget (liveness is checked outside this function).
  if (!input.crVisible) {
    return expired ? { kind: "timeout" } : { kind: "wait" };
  }

  if (input.status?.phase === "Succeeded" || input.status?.phase === "Failed") {
    return { kind: "resolve", status: input.status };
  }

  if (expired) {
    return { kind: "timeout" };
  }

  // A node dispatched to the POOLED SERVICE has no CR (published on the bus); requeueing it would duplicate work already in flight, so it only times out like anything else.
  if (input.node.agentCrName === null) {
    return { kind: "wait" };
  }

  // Absence (a 404) is the crash-between-claim-and-CR case, requeued after the startup grace runs from the execution clock (claim time), not enqueue time, to avoid requeuing a CR still provisioning.
  if (input.status === null) {
    return input.nowMs - executionStartMs < NODE_STARTUP_GRACE_MS
      ? { kind: "wait" }
      : { kind: "requeue" };
  }

  return { kind: "wait" };
}

interface GraphlessSweepContext {
  deps: AssemblyLineReaperDeps;
  offlineAgents: Set<string>;
  queueWaitMs: number;
  nowMs: number;
  whyUnclaimed: (requiredTags: string[]) => string;
}

/** Single-CR run record (FR6.8): checks the queue arm first (unclaimed visit), then the crash-orphan sweep off the backing task's terminal status. */
async function reapGraphlessRun(
  row: AssemblyRunRecord,
  ctx: GraphlessSweepContext,
): Promise<"queue-timeout" | "requeued" | "swept" | null> {
  const singleCrNodes = await ctx.deps.assemblyRuns.listStationRuns(row.id);
  const singleCrOpen = singleCrNodes.find((n) => n.outcome === null);

  // A `claimed` row that stops reporting is the WATCHER's to settle — owning its timeout here too would race it.
  const queueOutcome = singleCrOpen
    ? await settleUnclaimedSingleCr(row, singleCrOpen, ctx)
    : null;

  if (queueOutcome !== null) {
    return queueOutcome;
  }

  return sweepTerminalSingleCr(row, singleCrOpen, ctx.deps);
}

async function settleUnclaimedSingleCr(
  row: AssemblyRunRecord,
  singleCrOpen: StationRunRecord,
  ctx: GraphlessSweepContext,
): Promise<"queue-timeout" | "requeued" | null> {
  const { deps, offlineAgents, queueWaitMs, nowMs, whyUnclaimed } = ctx;
  // With no graph there is no node budget and no walk to notice — the queue wait is the only bound.
  const recovery = decideNodeRecovery({
    claimantOffline:
      singleCrOpen.clusterAgentId !== null &&
      offlineAgents.has(singleCrOpen.clusterAgentId),
    node: singleCrOpen,
    timeoutMinutes: undefined,
    status: null,
    nodeType: "agent",
    crVisible: false,
    queueWaitMs,
    nowMs,
  });

  if (recovery.kind === "queue-timeout") {
    await deps.assemblyRuns.finishStationRunOnce(
      singleCrOpen.id,
      "failed",
      undefined,
      {
        failureClass: "unclaimed",
        // Naming the tags is the point, exactly as on the graph arm.
        failureDetail: whyUnclaimed(singleCrOpen.requiredTags),
      },
    );
    await finishLine(
      row,
      "error",
      whyUnclaimed(singleCrOpen.requiredTags),
      deps,
    );

    return "queue-timeout";
  }

  if (recovery.kind === "requeue-offline") {
    await deps.assemblyRuns.requeueStationRun(singleCrOpen.id);
    await deps.audit?.({
      event_type: "cluster_agent_offline",
      payload: {
        cluster_agent_id: singleCrOpen.clusterAgentId,
        station_run_id: singleCrOpen.stationRunId,
        assembly_run_id: row.id,
        node_id: singleCrOpen.nodeId,
        elapsed_since_claim_ms: singleCrOpen.claimedAt
          ? nowMs - singleCrOpen.claimedAt.getTime()
          : null,
      },
    });

    return "requeued";
  }

  return null;
}

/** The crash case: a crash between the task status write and the watcher's close (or a dropped terminal event) leaves the row open forever, so close it from the backing task's status when terminal. */
async function sweepTerminalSingleCr(
  row: AssemblyRunRecord,
  singleCrOpen: StationRunRecord | undefined,
  deps: AssemblyLineReaperDeps,
): Promise<"swept" | null> {
  if (!row.taskId) {
    return null;
  }
  const taskStatus = await deps.taskStatus(row.taskId);
  const terminal =
    taskStatus !== null &&
    !["running", "queued", "pending"].includes(taskStatus);

  if (!terminal) {
    return null;
  }

  // The visit before the run, so a closed run never shows a station still executing.
  if (singleCrOpen) {
    await deps.assemblyRuns.finishStationRunOnce(
      singleCrOpen.id,
      stationOutcomeForRunOutcome(runOutcomeFromTaskStatus(taskStatus)),
    );
  }
  // finishLine (not finish) so the single-CR row's token is reclaimed and every terminal close routes through one path.
  await finishLine(row, runOutcomeFromTaskStatus(taskStatus), undefined, deps);

  return "swept";
}

/** finishLine (not bare finish) so the detect fan-out's pre-created job_run row is settled failed rather than left running forever. */
async function failLongQueuedLine(
  row: AssemblyRunRecord,
  deps: AssemblyLineReaperDeps,
  nowMs: number,
): Promise<number> {
  if (nowMs - row.createdAt.getTime() <= QUEUED_LIMIT_MINUTES * MINUTE_MS) {
    return 0;
  }
  await finishLine(row, "error", "assembly_line.start never completed", deps);

  return 1;
}

/** A dropped event lands here instead — same review/check, artifacts, and alerts the event path would have delivered, or the account-dry alarm depends on which door the event came through (#1456). */
async function settleResolvedNode(
  params: {
    row: AssemblyRunRecord;
    node: RunGraphNode;
    openNode: StationRunRecord;
    terminalStatus: AgentNodeStatus;
  },
  deps: AssemblyLineReaperDeps,
): Promise<void> {
  const { row, node, openNode, terminalStatus } = params;
  const status = normalizeAgentStatus(terminalStatus);
  const result = await deliverTerminalArtifacts(
    row,
    node,
    terminalStatus,
    deps,
  );

  if (result.outcome === "failed" && deps.alertBilling) {
    await deps.alertBilling(row.repo, node.type, status);
  }

  if (result.outcome === "failed" && deps.alertAgentConfig) {
    await deps.alertAgentConfig(row.repo, node.type, status);
  }

  if (result.failureClass) {
    deps.llmGate?.trip(result.failureClass, result.failureDetail);
  }

  await finishNodeTerminal(
    {
      row,
      node,
      nodeId: openNode.nodeId,
      iteration: openNode.iteration,
      result,
      output: status.output,
    },
    deps,
  );
}

/** What one sweep of one open line did, so the tick can tally without the loop knowing how any of it works. */
type ReapOutcome =
  | "queue-timeout"
  | "requeued"
  | "swept"
  | "resolved"
  | "timeout"
  | "failed-queued"
  | "advanced"
  | null;

interface ReapContext extends GraphlessSweepContext {
  centralClusterAgentId: string | null;
}

/** The node the reaper found open, with everything the recovery decision needed to reach its verdict. */
interface OpenNodeContext {
  row: AssemblyRunRecord;
  node: RunGraphNode;
  openNode: StationRunRecord;
  budgetMinutes: number | undefined;
}

/** One open line: no graph means the single-CR sweep, a still-queued line may have missed its start, an open node gets a recovery verdict, and none of the above means the walk simply stopped and is re-advanced. */
async function reapOpenRun(
  row: AssemblyRunRecord,
  ctx: ReapContext,
): Promise<ReapOutcome> {
  // Same rule the walk follows (FR6.38): reaping against a since-edited graph would resolve a node the run never had.
  const graph = await resolveRunGraph(row, ctx.deps.definitions);

  if (!graph) {
    return await reapGraphlessRun(row, ctx);
  }

  if (row.status === "queued") {
    const failed = await failLongQueuedLine(row, ctx.deps, ctx.nowMs);

    return failed > 0 ? "failed-queued" : null;
  }
  const nodes = await ctx.deps.assemblyRuns.listStationRuns(row.id);
  const openNode = nodes.find((n) => n.outcome === null);

  if (!openNode) {
    await advanceLine(row.id, ctx.deps);

    return "advanced";
  }
  const node = graph.nodes.find((n) => n.id === openNode.nodeId);

  return node ? await recoverOpenNode({ row, node, openNode }, ctx) : null;
}

/** Reads the node's live state — CR status, claimant health, applicable budget — and applies whatever `decideNodeRecovery` makes of it. */
async function recoverOpenNode(
  found: {
    row: AssemblyRunRecord;
    node: RunGraphNode;
    openNode: StationRunRecord;
  },
  ctx: ReapContext,
): Promise<ReapOutcome> {
  const { row, node, openNode } = found;
  const crVisible = agentCrVisible(openNode, ctx.centralClusterAgentId);
  // Never read CR status for a row this Floor cannot see — a satellite's CR read answers null, which would requeue (double-launch) work it's running.
  const status =
    crVisible && openNode.agentCrName
      ? await ctx.deps.readAgentStatus(openNode.agentCrName)
      : null;
  // The station's own budget (not the global sixty) when the YAML is silent, resolved ONCE so the failure message names the budget actually applied.
  const budgetMinutes = nodeTimeoutMinutes({
    yaml: node.timeout_minutes,
    manifest: stationBudgetFor(node.type),
  });
  const recovery = decideNodeRecovery({
    claimantOffline:
      openNode.clusterAgentId !== null &&
      ctx.offlineAgents.has(openNode.clusterAgentId),
    node: openNode,
    timeoutMinutes: budgetMinutes,
    status,
    nodeType: node.type,
    crVisible,
    queueWaitMs: ctx.queueWaitMs,
    nowMs: ctx.nowMs,
  });

  return await applyRecovery(
    recovery,
    { row, node, openNode, budgetMinutes },
    ctx,
  );
}

/** Carries out one recovery verdict. Every branch ends the node or puts its row back on the shelf; nothing here decides, it only acts. */
async function applyRecovery(
  recovery: ReturnType<typeof decideNodeRecovery>,
  found: OpenNodeContext,
  ctx: ReapContext,
): Promise<ReapOutcome> {
  const { row, node, openNode, budgetMinutes } = found;

  if (recovery.kind === "resolve") {
    await settleResolvedNode(
      { row, node, openNode, terminalStatus: recovery.status },
      ctx.deps,
    );

    return "resolved";
  }

  if (recovery.kind === "timeout") {
    await failOpenNode(found, ctx, {
      outcome: "failed",
      failureClass: "infra",
      // A node whose pod stopped reporting died of infrastructure, not the work — say so instead of a bare `failed` with no story.
      failureDetail: `${nodeKind(node)} node timed out after ${budgetMinutes ?? DEFAULT_TIMEOUT_MINUTES} minutes without reporting`,
    });
    console.warn(
      `[assembly-run-reaper] node ${openNode.nodeId} of ${row.id} timed out (${nodeKind(node)}-timeout)`,
    );

    return "timeout";
  }

  if (recovery.kind === "queue-timeout") {
    await failOpenNode(found, ctx, {
      outcome: "failed",
      // `unclaimed`, not `infra`: nothing ran, so this class is what makes the walk refuse the retry.
      failureClass: "unclaimed",
      // Naming the tags is the point: a line stalled on missing `gpu` capacity must say so, not report a generic timeout.
      failureDetail: ctx.whyUnclaimed(openNode.requiredTags),
    });
    console.warn(
      `[assembly-run-reaper] node ${openNode.nodeId} of ${row.id} sat queued past ${ctx.queueWaitMs / MINUTE_MS}m unclaimed`,
    );

    return "queue-timeout";
  }

  if (recovery.kind === "requeue-offline") {
    return await requeueOffline(found, ctx);
  }

  if (recovery.kind === "requeue") {
    // Crash between claim and CR create: reset the SAME row to `queued` so another claim takes it — the armed dispatch spec rides the row, no second builder.
    await ctx.deps.assemblyRuns.requeueStationRun(openNode.id);
    console.warn(
      `[assembly-run-reaper] requeued node ${openNode.nodeId} of ${row.id} — its claim produced no CR within the startup grace`,
    );

    return "requeued";
  }

  return null;
}

function nodeKind(node: RunGraphNode): string {
  return node.type === "agent" ? "agent" : "station";
}

async function failOpenNode(
  found: OpenNodeContext,
  ctx: ReapContext,
  result: NodeResult,
): Promise<void> {
  await finishNodeTerminal(
    {
      row: found.row,
      node: found.node,
      nodeId: found.openNode.nodeId,
      iteration: found.openNode.iteration,
      result,
    },
    ctx.deps,
  );
}

/** Same row back on the shelf; the audit entry makes a flapping cluster diagnosable without database access (FR7 renders it). */
async function requeueOffline(
  found: OpenNodeContext,
  ctx: ReapContext,
): Promise<ReapOutcome> {
  const { row, openNode } = found;

  await ctx.deps.assemblyRuns.requeueStationRun(openNode.id);
  await ctx.deps.audit?.({
    event_type: "cluster_agent_offline",
    payload: {
      cluster_agent_id: openNode.clusterAgentId,
      station_run_id: openNode.stationRunId,
      assembly_run_id: row.id,
      node_id: openNode.nodeId,
      elapsed_since_claim_ms: openNode.claimedAt
        ? ctx.nowMs - openNode.claimedAt.getTime()
        : null,
    },
  });

  return "requeued";
}

/** Everything one tick reads once and every line then shares: the clock, the queue budget, which clusters are dead, and the capacity picture that explains an unclaimed node. */
async function buildReapContext(
  deps: AssemblyLineReaperDeps,
): Promise<ReapContext> {
  const nowMs = (deps.now?.() ?? new Date()).getTime();
  const queueWaitMs = deps.queueWaitMs ?? stationQueueWaitMs();
  const offlineAgents =
    (await deps.offlineClusterAgents?.(
      new Date(nowMs - OFFLINE_THRESHOLD_MS),
    )) ?? new Set<string>();
  // AFTER the offline sweep, which mutates what this reads — reading first would misreport a cluster that just died as "capable ... it may be wedged".
  const clusterAgents = (await deps.listClusterAgents?.()) ?? [];

  return {
    deps,
    nowMs,
    queueWaitMs,
    offlineAgents,
    centralClusterAgentId: await deps.centralClusterAgentId(),
    whyUnclaimed: (requiredTags: string[]): string =>
      unclaimedDetail({
        requiredTags,
        waitMinutes: queueWaitMs / MINUTE_MS,
        verdict: capacityFor(requiredTags, clusterAgents),
      }),
  };
}

/** One sweep over every open line; per-line failures are logged and skipped so a single bad row never wedges the tick. */
export async function assemblyLineReaperJob(
  deps: AssemblyLineReaperDeps,
): Promise<string> {
  const open = await deps.assemblyRuns.listOpen();
  const ctx = await buildReapContext(deps);
  const tally = new Map<ReapOutcome, number>();

  for (const row of open) {
    try {
      const outcome = await reapOpenRun(row, ctx);

      tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
    } catch (err) {
      console.error(
        `[assembly-run-reaper] ${row.blueprintName}/${row.id}: ${(err as Error).message}`,
      );
    }
  }
  const count = (outcome: ReapOutcome): number => tally.get(outcome) ?? 0;

  return `resolved ${count("resolved")}, requeued ${count("requeued")}, timed out ${count("timeout")}, queue-timed-out ${count("queue-timeout")}, failed-queued ${count("failed-queued")}, re-advanced ${count("advanced")}, swept-single-cr ${count("swept")} across ${open.length} open line(s)`;
}
