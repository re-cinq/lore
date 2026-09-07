// Carrying out one recovery verdict: every branch here ends the open node or puts its row back on the shelf; nothing here decides, decideNodeRecovery already did.

import { nodeTimeoutMinutes, stationBudgetFor } from "./node-timeout.js";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { AgentNodeStatus } from "@re-cinq/lore-assembly-lines";
import type {
  AssemblyRunRecord,
  StationRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { agentCrVisible } from "./cr-visibility.js";
import { finishNodeTerminal, normalizeAgentStatus } from "./node-terminal.js";
import { deliverTerminalArtifacts } from "./node-event-handler.js";
import {
  decideNodeRecovery,
  DEFAULT_TIMEOUT_MINUTES,
} from "./node-recovery-decision.js";
import type { GraphlessSweepContext } from "./graphless-run-sweep.js";
import type { AssemblyLineReaperDeps } from "./assembly-run-reaper.js";

const MINUTE_MS = 60_000;

/** What one sweep of one open line did, so the tick can tally without the loop knowing how any of it works. */
export type ReapOutcome =
  | "queue-timeout"
  | "requeued"
  | "swept"
  | "resolved"
  | "timeout"
  | "failed-queued"
  | "advanced"
  | null;

export interface ReapContext extends GraphlessSweepContext {
  centralClusterAgentId: string | null;
}

/** The node the reaper found open, with everything the recovery decision needed to reach its verdict. */
export interface OpenNodeContext {
  row: AssemblyRunRecord;
  node: RunGraphNode;
  openNode: StationRunRecord;
  budgetMinutes: number | undefined;
}

interface FailedOutcomeAlertTarget {
  row: AssemblyRunRecord;
  node: RunGraphNode;
  status: AgentNodeStatus;
}

// Both alert channels fire under the same condition; splitting this out is the whole reason settleResolvedNode's complexity stays low.
async function alertOnFailedOutcome(
  target: FailedOutcomeAlertTarget,
  result: Awaited<ReturnType<typeof deliverTerminalArtifacts>>,
  deps: AssemblyLineReaperDeps,
): Promise<void> {
  if (result.outcome !== "failed") {
    return;
  }
  const { row, node, status } = target;

  if (deps.alertBilling) {
    await deps.alertBilling(row.repo, node.type, status);
  }

  if (deps.alertAgentConfig) {
    await deps.alertAgentConfig(row.repo, node.type, status);
  }
}

/** A dropped event lands here instead — same review/check, artifacts, and alerts the event path would have delivered, or the account-dry alarm depends on which door the event came through (#1456). */
/** A failure is reported twice on purpose: to a human, and to the dispatch gate. The gate matters most for a CREDIT failure — every subsequent node would fail identically, so tripping it parks the runs instead of burning them. */
async function reportFailure(
  what: {
    row: AssemblyRunRecord;
    node: RunGraphNode;
    status: ReturnType<typeof normalizeAgentStatus>;
  },
  result: Awaited<ReturnType<typeof deliverTerminalArtifacts>>,
  deps: AssemblyLineReaperDeps,
): Promise<void> {
  await alertOnFailedOutcome(what, result, deps);

  if (result.failureClass) {
    deps.llmGate?.trip(result.failureClass, result.failureDetail);
  }
}

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

  await reportFailure({ row, node, status }, result, deps);
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

/** A node whose pod stopped reporting died of infrastructure, not the work — say so instead of a bare `failed` with no story. */
async function applyTimeoutRecovery(
  found: OpenNodeContext,
  ctx: ReapContext,
): Promise<ReapOutcome> {
  const { row, node, openNode, budgetMinutes } = found;

  await failOpenNode(found, ctx, {
    outcome: "failed",
    failureClass: "infra",
    failureDetail: `${nodeKind(node)} node timed out after ${budgetMinutes ?? DEFAULT_TIMEOUT_MINUTES} minutes without reporting`,
  });
  console.warn(
    `[assembly-run-reaper] node ${openNode.nodeId} of ${row.id} timed out (${nodeKind(node)}-timeout)`,
  );

  return "timeout";
}

/** Carries out one recovery verdict. Every branch ends the node or puts its row back on the shelf; nothing here decides, it only acts. */
/** Nothing ever ran, so this fails as `unclaimed` rather than `infra` — the class is what makes the walk refuse a retry. The detail names the TAGS: a line stalled on missing `gpu` capacity must say so instead of reporting a generic timeout. */
async function failUnclaimed(
  found: OpenNodeContext,
  ctx: ReapContext,
): Promise<ReapOutcome> {
  const { row, openNode } = found;

  await failOpenNode(found, ctx, {
    outcome: "failed",
    failureClass: "unclaimed",
    failureDetail: ctx.whyUnclaimed(openNode.requiredTags),
  });
  console.warn(
    `[assembly-run-reaper] node ${openNode.nodeId} of ${row.id} sat queued past ${ctx.queueWaitMs / MINUTE_MS}m unclaimed`,
  );

  return "queue-timeout";
}

/** A crash between claim and CR create: the SAME row resets to `queued` so another claim takes it. The armed dispatch spec rides that row, so nothing has to rebuild it. */
async function requeueUnstarted(
  found: OpenNodeContext,
  ctx: ReapContext,
): Promise<ReapOutcome> {
  const { row, openNode } = found;

  await ctx.deps.assemblyRuns.requeueStationRun(openNode.id);
  console.warn(
    `[assembly-run-reaper] requeued node ${openNode.nodeId} of ${row.id} — its claim produced no CR within the startup grace`,
  );

  return "requeued";
}

export async function applyRecovery(
  recovery: ReturnType<typeof decideNodeRecovery>,
  found: OpenNodeContext,
  ctx: ReapContext,
): Promise<ReapOutcome> {
  const { row, node, openNode } = found;

  if (recovery.kind === "resolve") {
    await settleResolvedNode(
      { row, node, openNode, terminalStatus: recovery.status },
      ctx.deps,
    );

    return "resolved";
  }

  if (recovery.kind === "timeout") {
    return await applyTimeoutRecovery(found, ctx);
  }

  if (recovery.kind === "queue-timeout") {
    return await failUnclaimed(found, ctx);
  }

  if (recovery.kind === "requeue-offline") {
    return await requeueOffline(found, ctx);
  }

  if (recovery.kind === "requeue") {
    return await requeueUnstarted(found, ctx);
  }

  return null;
}

/** The live facts a recovery decision needs. CR status is NEVER read for a row this Floor cannot see — a satellite's CR reads back null here, and null means requeue, which would double-launch work that is still running. The budget is resolved once, so the failure message names the budget actually applied rather than the global default. */
async function readNodeState(
  found: {
    node: RunGraphNode;
    openNode: StationRunRecord;
  },
  ctx: ReapContext,
): Promise<{
  crVisible: boolean;
  status: Awaited<ReturnType<ReapContext["deps"]["readAgentStatus"]>> | null;
  budgetMinutes: number | undefined;
}> {
  const { node, openNode } = found;
  const crVisible = agentCrVisible(openNode, ctx.centralClusterAgentId);

  return {
    crVisible,
    status:
      crVisible && openNode.agentCrName
        ? await ctx.deps.readAgentStatus(openNode.agentCrName)
        : null,
    budgetMinutes: nodeTimeoutMinutes({
      yaml: node.timeout_minutes,
      manifest: stationBudgetFor(node.type),
    }),
  };
}

/** Reads the node's live state — CR status, claimant health, applicable budget — and applies whatever `decideNodeRecovery` makes of it. */
export async function recoverOpenNode(
  found: {
    row: AssemblyRunRecord;
    node: RunGraphNode;
    openNode: StationRunRecord;
  },
  ctx: ReapContext,
): Promise<ReapOutcome> {
  const { row, node, openNode } = found;
  const { crVisible, status, budgetMinutes } = await readNodeState(found, ctx);
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
