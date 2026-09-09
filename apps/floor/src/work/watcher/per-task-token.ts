/** Best-effort per-task token + AgentDefinition/Station cleanup (#697). A job service: the watcher reclaims it when a task settles, the walk when a whole line is done, and the review line when its own run ends. */

import { HttpTokenCleanup } from "@re-cinq/lore-shared";
import type { StationRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { agentCrVisible } from "../assembly-run/cr-visibility.js";
import { centralClusterAgentId } from "../../outbound/central-cluster-agent.js";
import { clusterAgent, pipeline } from "../../outbound/queues.js";

export function cleanupPerTaskToken(taskId: string): Promise<void> {
  return routeTokenCleanup(taskId).catch((err) =>
    // Swallowed so a task still settles on reclaim failure, but logged (used to hide a 403).
    console.warn(
      `[agent-watcher] token cleanup for ${taskId} failed:`,
      (err as Error).message,
    ),
  );
}

/** The DELETE goes to the central cluster-agent, which only holds the Secret for runs it claimed itself — a satellite-only task's Secret lives where this Floor cannot reach (#1627). */
async function routeTokenCleanup(taskId: string): Promise<void> {
  const decision = decideTokenCleanup(
    await stationRunsForTask(taskId),
    await centralClusterAgentId(),
  );

  if (decision === "skip") {
    console.warn(
      `[agent-watcher] token cleanup for ${taskId} skipped: every station run was claimed by a cluster this Floor cannot reach`,
    );

    return;
  }

  await new HttpTokenCleanup(clusterAgent()).cleanup(taskId);
}

/** "central" when any run is visible from here OR the task never had a station run (a legacy single-CR task, launched centrally); "skip" only when every run was PROVABLY claimed elsewhere. */
export function decideTokenCleanup(
  runsForTask: readonly Pick<StationRunRecord, "clusterAgentId" | "status">[],
  centralId: string | null,
): "central" | "skip" {
  // An unresolved central id (central not registered yet, or LORE_CENTRAL_CLUSTER_AGENT_NAME drift) says we do not KNOW who claimed these runs, not that a satellite did — and failing closed on it stops reclaiming every pull-dispatched run's Secret, which is the agent-secrets leak of #1647. The DELETE is best-effort and central holds only what it claimed, so attempting it is the safe direction.
  return centralId === null ||
    runsForTask.length === 0 ||
    runsForTask.some((run) => agentCrVisible(run, centralId))
    ? "central"
    : "skip";
}

async function stationRunsForTask(taskId: string): Promise<StationRunRecord[]> {
  const runs = await pipeline().assemblyRuns.listForTask(taskId);

  return (
    await Promise.all(
      runs.map((run) => pipeline().assemblyRuns.listStationRuns(run.id)),
    )
  ).flat();
}
