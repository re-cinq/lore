// The reaper's single-CR (definition-less) run sweep (FR6.8): checks the queue arm first (unclaimed visit), then closes a crash-orphaned row off the backing task's terminal status.

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { StationRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { finishLine } from "./finish-line.js";
import { decideNodeRecovery } from "./node-recovery-decision.js";
import {
  runOutcomeFromTaskStatus,
  stationOutcomeForRunOutcome,
} from "../../domain/agent-watcher-logic.js";
import type { AssemblyLineReaperDeps } from "./assembly-run-reaper.js";

export interface GraphlessSweepContext {
  deps: AssemblyLineReaperDeps;
  offlineAgents: Set<string>;
  queueWaitMs: number;
  nowMs: number;
  whyUnclaimed: (requiredTags: string[]) => string;
}

/** Single-CR run record (FR6.8): checks the queue arm first (unclaimed visit), then the crash-orphan sweep off the backing task's terminal status. */
export async function reapGraphlessRun(
  row: AssemblyRunRecord,
  ctx: GraphlessSweepContext,
): Promise<"queue-timeout" | "requeued" | "swept" | null> {
  const { assemblyRuns } = ctx.deps;
  const singleCrNodes = await assemblyRuns.listStationRuns(row.id);
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

/** Nothing ever claimed it, so the run ends. Both the node and the line carry the same reason — naming the required tags is the point, exactly as on the graph arm. */
async function failUnclaimed(
  row: AssemblyRunRecord,
  singleCrOpen: StationRunRecord,
  ctx: GraphlessSweepContext,
): Promise<void> {
  const { deps, whyUnclaimed } = ctx;
  const reason = whyUnclaimed(singleCrOpen.requiredTags);

  await deps.assemblyRuns.finishStationRunOnce(
    singleCrOpen.id,
    "failed",
    undefined,
    { failureClass: "unclaimed", failureDetail: reason },
  );
  await finishLine(row, "error", reason, deps);
}

/** The claimant went offline, so the work goes back on the queue for another agent rather than failing. Audited, because a cluster agent dropping claims is a fleet symptom, not this run's problem. */
async function requeueOffline(
  row: AssemblyRunRecord,
  singleCrOpen: StationRunRecord,
  ctx: GraphlessSweepContext,
): Promise<void> {
  const { deps, nowMs } = ctx;

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
}

async function settleUnclaimedSingleCr(
  row: AssemblyRunRecord,
  singleCrOpen: StationRunRecord,
  ctx: GraphlessSweepContext,
): Promise<"queue-timeout" | "requeued" | null> {
  const recovery = recoveryForSingleCr(singleCrOpen, ctx);

  if (recovery.kind === "queue-timeout") {
    await failUnclaimed(row, singleCrOpen, ctx);

    return "queue-timeout";
  }

  if (recovery.kind === "requeue-offline") {
    await requeueOffline(row, singleCrOpen, ctx);

    return "requeued";
  }

  return null;
}

/** With no graph there is no node budget and no walk to notice — the queue wait is the only bound. */
function recoveryForSingleCr(
  singleCrOpen: StationRunRecord,
  ctx: GraphlessSweepContext,
): ReturnType<typeof decideNodeRecovery> {
  const { offlineAgents, queueWaitMs, nowMs } = ctx;

  return decideNodeRecovery({
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
}

/** The crash case: a crash between the task status write and the watcher's close (or a dropped terminal event) leaves the row open forever, so close it from the backing task's status when terminal. */
async function sweepTerminalSingleCr(
  row: AssemblyRunRecord,
  singleCrOpen: StationRunRecord | undefined,
  deps: AssemblyLineReaperDeps,
): Promise<"swept" | null> {
  const taskStatus = await terminalTaskStatus(row, deps);

  if (taskStatus === null) {
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

/** The backing task's status once it has settled; null while it still runs, and null for a task-less row that can never be swept this way. */
async function terminalTaskStatus(
  row: AssemblyRunRecord,
  deps: AssemblyLineReaperDeps,
): Promise<string | null> {
  if (!row.taskId) {
    return null;
  }
  const taskStatus = await deps.taskStatus(row.taskId);
  const settled =
    taskStatus !== null &&
    !["running", "queued", "pending"].includes(taskStatus);

  return settled ? taskStatus : null;
}
