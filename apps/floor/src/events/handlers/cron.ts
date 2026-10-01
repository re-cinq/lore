/** Layer-3 handlers for `cron.*.tick` events: light/operational jobs safe in Floor pod. */

import { staleTaskCheckJob } from "../../work/task/stale-task-check.js";
import { leaseReaperJob } from "../../work/lease/lease-reaper.js";
import { reconcileAgents } from "../../work/watcher/agent-reconcile.js";
import type { EventHandler } from "../../domain/event-types.js";

/** Adapt an existing `() => Promise<string>` job into an event handler (drop the summary). */
const fromJob =
  (job: () => Promise<string>): EventHandler =>
  async () => {
    await job();
  };

export const staleTaskCheck = fromJob(staleTaskCheckJob);
/** Delete leases >5min past expiry, writing a `lease_expired` audit entry per row. */
export const leaseReaper = fromJob(() => leaseReaperJob());

type AuditEntry = { event_type: string; payload: Record<string, unknown> };

/** The reaper's own reads, bound to the Floor's queue singletons. */
function reaperPorts(
  taskStore: typeof import("../../outbound/queues.js").taskStore,
  clusterAgents: typeof import("../../outbound/queues.js").clusterAgents,
  centralClusterAgentId: () => Promise<string | null>,
  writeAuditLog: (entry: AuditEntry) => Promise<void>,
) {
  return {
    taskStatus: async (taskId: string) =>
      (await taskStore().getById(taskId))?.status ?? null,
    offlineClusterAgents: offlineClusterAgentIds(clusterAgents),
    audit: (entry: AuditEntry) => writeAuditLog(entry),
    listClusterAgents: () => clusterAgents().list(),
    centralClusterAgentId,
  };
}

/** FR4's sweep in one step — flip the silent agents to offline, then answer with who is offline — because the requeue that follows must act on the set the flip just produced, not on a snapshot taken before it. */
function offlineClusterAgentIds(
  clusterAgents: typeof import("../../outbound/queues.js").clusterAgents,
) {
  return async (cutoff: Date) => {
    await clusterAgents().markOffline(cutoff);
    const all = await clusterAgents().list();

    return new Set(all.filter((a) => a.status === "offline").map((a) => a.id));
  };
}

/** Loaded lazily so the Floor cold start does not pull the reaper graph in. */
function reaperModules() {
  return Promise.all([
    import("../../work/assembly-run/assembly-run-reaper.js"),
    import("../../work/assembly-run/node-event-handler.js"),
    import("../../outbound/queues.js"),
    import("../../outbound/audit.js"),
    import("../../outbound/central-cluster-agent.js"),
  ]);
}

/** An all-zero sweep is the normal case and stays silent. */
function logReaperSummary(summary: string): void {
  if (
    !summary.startsWith(
      "resolved 0, requeued 0, timed out 0, queue-timed-out 0",
    )
  ) {
    console.log(`[assembly-run-reaper] ${summary}`);
  }
}

/** Liveness bound: resolve dropped node events, requeue orphans, time out stuck nodes. */
export const assemblyLineReaper: EventHandler = async () => {
  const [reaper, nodeEvents, queues, audit, central] = await reaperModules();
  const summary = await reaper.assemblyLineReaperJob({
    ...(await nodeEvents.productionNodeEventDeps()),
    ...reaperPorts(
      queues.taskStore,
      queues.clusterAgents,
      central.centralClusterAgentId,
      audit.writeAuditLog,
    ),
  });

  logReaperSummary(summary);
};

/** Close circuit breaker loop: probe Anthropic account and un-block dispatch if it can answer (fail-open). */
export const llmCreditProbe: EventHandler = async () => {
  const [{ anthropicCreditsExhausted }, { llmDispatchGate }] =
    await Promise.all([
      import("@re-cinq/lore-shared/llm/credit-probe.js"),
      import("../../work/assembly-run/llm-dispatch-gate.js"),
    ]);

  if (!llmDispatchGate.isBlocked()) {
    return;
  }

  if (await anthropicCreditsExhausted()) {
    return;
  }

  llmDispatchGate.clear();
  console.log(
    "[llm-dispatch-gate] the Anthropic account answered — resuming agent dispatch",
  );
};

/** Safety net for dropped k8s watch events: re-emit for terminal-unhandled CRs + prune old ones. */
export const agentWatcherReconcile: EventHandler = async () => {
  await reconcileAgents();
};
