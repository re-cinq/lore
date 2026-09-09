/** Layer-3 handlers for `cron.*.tick` events: light/operational jobs safe in Floor pod. */

import { specTaskExecutorJob } from "../../work/task/spec-task-executor.js";
import { staleTaskCheckJob } from "../../work/task/stale-task-check.js";
import { featurePlanningReaperJob } from "../../work/task/feature-planning-reaper.js";
import { leaseReaperJob } from "../../work/lease/lease-reaper.js";
import {
  pruneHandled,
  orphanedEvents,
  deadLettered,
} from "../../outbound/event-store.js";
import { pipeline, stationClient } from "../../outbound/queues.js";
import { reconcileAgents } from "../../work/watcher/agent-reconcile.js";
import type { EventHandler } from "../../domain/event-types.js";

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

type AuditEntry = { event_type: string; payload: Record<string, unknown> };

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

/** Orphan report lookback window (matches hourly tick); no skip or re-report. */
const ORPHAN_WINDOW_MINUTES = 60;
const DEAD_LETTER_WINDOW_MINUTES = 60;

// Report unclaimed event names to prevent silent producer failures.
async function reportOrphanedEvents(): Promise<void> {
  const orphaned = await orphanedEvents(ORPHAN_WINDOW_MINUTES);

  if (orphaned.length === 0) {
    return;
  }
  const detail = orphaned.map((o) => `${o.event_name} x${o.count}`).join(", ");

  console.error(
    `[events] ${orphaned.length} event name(s) reached nobody in the last ${ORPHAN_WINDOW_MINUTES}m — no subscriber is registered for: ${detail}`,
  );
}

/** Report handlers that gave up, so a failing safety net is not discovered by its silence. The reconcile tick dead-lettered 84 deliveries across a 3-hour cluster-agent outage (2026-09-08) and said nothing an operator would see; the rows were the only record. Grouped and periodic rather than per-row, because an outage produces one identical failure a minute. */
async function reportDeadLetters(): Promise<void> {
  const dead = await deadLettered(DEAD_LETTER_WINDOW_MINUTES);

  if (dead.length === 0) {
    return;
  }
  const detail = dead
    .map((d) => `${d.event_name} x${d.count} (${d.last_error ?? "no error"})`)
    .join(", ");

  console.error(
    `[events] ${dead.length} handler(s) gave up in the last ${DEAD_LETTER_WINDOW_MINUTES}m — dead-lettered: ${detail}`,
  );
}

/** Per-tool-call events and full transcripts age out on their own retention windows. */
async function pruneAgentRunRetention(): Promise<void> {
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
}

/** Housekeeping: prune old terminal events and agent run events past retention. */
export const eventsPrune: EventHandler = async () => {
  const n = await pruneHandled(7);

  if (n > 0) {
    console.log(`[events] pruned ${n} handled delivery(ies)`);
  }

  await reportOrphanedEvents();
  await reportDeadLetters();
  await pruneAgentRunRetention();
};

/** Safety net for dropped k8s watch events: re-emit for terminal-unhandled CRs + prune old ones. */
export const agentWatcherReconcile: EventHandler = async () => {
  await reconcileAgents();
};
