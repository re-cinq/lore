/** Layer-3 handlers for `cron.*.tick` events: light/operational jobs safe in Floor pod. */

import { specTaskExecutorJob } from "./task/spec-task-executor.js";
import { staleTaskCheckJob } from "./task/stale-task-check.js";
import { featurePlanningReaperJob } from "./task/feature-planning-reaper.js";
import { leaseReaperJob } from "./lease/lease-reaper.js";
import { pruneHandled, orphanedEvents } from "../kernel/event-store.js";
import { pipeline, stationClient } from "../kernel/queues.js";
import { reconcileAgents } from "../listeners/agent-reconcile.js";
import type { EventHandler } from "../kernel/event-types.js";

/** Agent run events are per-tool-call telemetry: high volume, low half-life. */
const AGENT_RUN_EVENT_RETENTION_DAYS = 14;

/** Full-fidelity transcript retention (configurable via LORE_AGENT_RUN_TURN_RETENTION_DAYS). */
const DEFAULT_AGENT_RUN_TURN_RETENTION_DAYS = 30;

/** Postgres `make_interval` takes int32; absurd overrides fall back to not fail hourly tick. */
const MAX_AGENT_RUN_TURN_RETENTION_DAYS = 3650;

const turnRetentionDays = (): number => {
  const raw = process.env.LORE_AGENT_RUN_TURN_RETENTION_DAYS;

  if (raw === undefined) {
    return DEFAULT_AGENT_RUN_TURN_RETENTION_DAYS;
  }
  const parsed = Number(raw);

  if (
    Number.isInteger(parsed) &&
    parsed > 0 &&
    parsed <= MAX_AGENT_RUN_TURN_RETENTION_DAYS
  ) {
    return parsed;
  }
  console.warn(
    `[events] ignoring LORE_AGENT_RUN_TURN_RETENTION_DAYS=${raw}: not an integer in 1..${MAX_AGENT_RUN_TURN_RETENTION_DAYS}, keeping ${DEFAULT_AGENT_RUN_TURN_RETENTION_DAYS}`,
  );

  return DEFAULT_AGENT_RUN_TURN_RETENTION_DAYS;
};

/** Adapt an existing `() => Promise<string>` job into an event handler (drop the summary). */
const fromJob =
  (job: () => Promise<string>): EventHandler =>
  async () => {
    await job();
  };

/** Run a station in the stations service; Floor keeps schedule and overlap guard. */
const fromStation = (name: string): EventHandler =>
  fromJob(() => stationClient().run(name));

export const mergeCheck = fromStation("merge-check");
export const prReadyCheck = fromStation("pr-ready-check");
export const approvalCheck = fromStation("approval-check");

/** Weekly link backfill fans out per SPECIFICATION, not per repository. */
export const specCoverageBackfill = fromStation("backfill-scan");
export const specTaskExecutor = fromJob(specTaskExecutorJob);
export const staleTaskCheck = fromJob(staleTaskCheckJob);
export const featurePlanningReaper = fromJob(featurePlanningReaperJob);

/** Delete leases >5min past expiry, writing a `lease_expired` audit entry per row. */
export const leaseReaper = fromJob(() => leaseReaperJob());

/** Liveness bound: resolve dropped node events, requeue orphans, time out stuck nodes. */
export const assemblyLineReaper: EventHandler = async () => {
  const [
    { assemblyLineReaperJob, centralClusterAgentName },
    { productionNodeEventDeps },
    { taskStore, clusterAgents },
  ] = await Promise.all([
    import("./assembly-run/assembly-run-reaper.js"),
    import("./assembly-run/node-event-handler.js"),
    import("../kernel/queues.js"),
  ]);
  const { writeAuditLog } = await import("./lib/audit.js");
  const summary = await assemblyLineReaperJob({
    ...(await productionNodeEventDeps()),
    taskStatus: async (taskId) =>
      (await taskStore().getById(taskId))?.status ?? null,
    // FR4's offline sweep: flip the silent, then requeue what the dead held.
    offlineClusterAgents: async (cutoff) => {
      await clusterAgents().markOffline(cutoff);
      const all = await clusterAgents().list();

      return new Set(
        all.filter((a) => a.status === "offline").map((a) => a.id),
      );
    },
    audit: (entry) => writeAuditLog(entry),
    listClusterAgents: () => clusterAgents().list(),
    centralClusterAgentId: async () =>
      (await clusterAgents().findByName(centralClusterAgentName()))?.id ?? null,
  });

  if (
    !summary.startsWith(
      "resolved 0, requeued 0, timed out 0, queue-timed-out 0",
    )
  ) {
    console.log(`[assembly-run-reaper] ${summary}`);
  }
};

/** Close circuit breaker loop: probe Anthropic account and un-block dispatch if it can answer (fail-open). */
export const llmCreditProbe: EventHandler = async () => {
  const [{ anthropicCreditsExhausted }, { llmDispatchGate }] =
    await Promise.all([
      import("@re-cinq/lore-shared/llm/credit-probe.js"),
      import("./assembly-run/llm-dispatch-gate.js"),
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

/** Orphan report lookback window (matches hourly tick); no skip or re-report. */
const ORPHAN_WINDOW_MINUTES = 60;

/** Housekeeping: prune old terminal events and agent run events past retention. */
export const eventsPrune: EventHandler = async () => {
  const n = await pruneHandled(7);

  if (n > 0) {
    console.log(`[events] pruned ${n} handled delivery(ies)`);
  }

  // Report unclaimed event names to prevent silent producer failures.
  const orphaned = await orphanedEvents(ORPHAN_WINDOW_MINUTES);

  if (orphaned.length > 0) {
    const detail = orphaned
      .map((o) => `${o.event_name} x${o.count}`)
      .join(", ");

    console.error(
      `[events] ${orphaned.length} event name(s) reached nobody in the last ${ORPHAN_WINDOW_MINUTES}m — no subscriber is registered for: ${detail}`,
    );
  }

  const runEvents = await pipeline().agentRunEvents.pruneOld(
    AGENT_RUN_EVENT_RETENTION_DAYS,
  );

  if (runEvents > 0) {
    console.log(`[events] pruned ${runEvents} agent run event(s)`);
  }

  const runTurns = await pipeline().agentRunTurns.pruneOld(turnRetentionDays());

  if (runTurns > 0) {
    console.log(`[events] pruned ${runTurns} agent run turn(s)`);
  }
};

/** Safety net for dropped k8s watch events: re-emit for terminal-unhandled CRs + prune old ones. */
export const agentWatcherReconcile: EventHandler = async () => {
  await reconcileAgents();
};
