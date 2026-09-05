// The reaper's single-CR (definition-less) run sweep (FR6.8): checks the queue arm first (unclaimed visit), then closes a crash-orphaned row off the backing task's terminal status.

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { StationRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { finishLine } from "./finish-line.js";
import { decideNodeRecovery } from "./node-recovery-decision.js";
import {
  runOutcomeFromTaskStatus,
  stationOutcomeForRunOutcome,
} from "../watcher/agent-watcher-logic.js";
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
