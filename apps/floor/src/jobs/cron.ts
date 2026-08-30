/**
 * Layer-3 handlers for `cron.*.tick` events. The in-process scheduler no longer
 * runs these jobs directly — it emits a tick event and the loop dispatches here.
 * These are the light/operational jobs that are safe to run in the Floor pod;
 * heavy batch jobs (reindex/eval/gap-detect …) are handled separately.
 */

import { specTaskExecutorJob } from "./task/spec-task-executor.js";
import { staleTaskCheckJob } from "./task/stale-task-check.js";
import { featurePlanningReaperJob } from "./task/feature-planning-reaper.js";
import { leaseReaperJob } from "../main-loop/lease/lease-reaper.js";
import { pruneHandled, orphanedEvents } from "../main-loop/store.js";
import { pipeline, stationClient } from "../kernel/queues.js";
import { reconcileAgents } from "../listeners/agent-reconcile.js";
import type { EventHandler } from "../main-loop/types.js";

/** Agent run events are per-tool-call telemetry: high volume, low half-life. */
const AGENT_RUN_EVENT_RETENTION_DAYS = 14;

/** Turns are the full-fidelity transcript: kept longer than the projection's 14
 *  days because the store exists precisely for questions asked after the live
 *  view has moved on, but deliberately conservative. There is no pilot and so no
 *  growth measurement to justify a longer horizon; 30 days is the starting bet
 *  and the prune's log line is the only growth signal until one exists. The env
 *  override is the operator lever the GCS task-log bucket had via the
 *  `log_retention_days` terraform variable (also 30 by default) — read per call
 *  (an hourly tick, so free) purely as a test seam; env is fixed for a pod's
 *  lifetime either way. */
const DEFAULT_AGENT_RUN_TURN_RETENTION_DAYS = 30;

/** Postgres `make_interval(days => N)` takes an int32; an absurd override must
 *  fall back rather than fail every hourly eventsPrune tick. */
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

/**
 * Run a station that lives in the stations service.
 *
 * The Floor keeps the schedule, the `job_runs` row and the overlap guard; the
 * work itself moved (ADR-024's service-endpoint station form). A refusal
 * propagates so the scheduler records a failed run rather than a silent no-op.
 */
const fromStation = (name: string): EventHandler =>
  fromJob(() => stationClient().run(name));

export const mergeCheck = fromStation("merge-check");
export const prReadyCheck = fromStation("pr-ready-check");
export const approvalCheck = fromStation("approval-check");

/**
 * The weekly link backfill fans out per SPECIFICATION, not per repository.
 *
 * It was one job per repo at a 30-minute budget, judging every candidate
 * statement of every spec with a model — so a failure cost the whole repo's pass
 * and the deadline was the only thing bounding how many PRs it opened. The scan
 * starts one unit per spec, under a cap that is now a number someone chose.
 */
export const specCoverageBackfill = fromStation("backfill-scan");
export const specTaskExecutor = fromJob(specTaskExecutorJob);
export const staleTaskCheck = fromJob(staleTaskCheckJob);
export const featurePlanningReaper = fromJob(featurePlanningReaperJob);

/** Delete leases >5min past expiry, writing a `lease_expired` audit entry per row. */
export const leaseReaper = fromJob(() => leaseReaperJob());

/** The event-driven walk's liveness bound: resolve dropped node-terminal events,
 *  requeue claims that produced no CR, fail rows queued past the claim wait,
 *  time out stuck nodes, fail wedged rows. */
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
    // What the queue-timeout message reads to name the cluster that could have
    // taken the work and did not — paused, offline, or never registered.
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

/**
 * Close the circuit breaker's loop: ask the account whether it can answer, and
 * let dispatch through again if it can.
 *
 * Nothing else can clear the gate. The failures that trip it arrive from pods,
 * and once dispatch is blocked there are no more pods to report — so without a
 * probe the factory would stay parked until someone restarted the Floor.
 *
 * Fail-open by construction: `anthropicCreditsExhausted` returns false with no
 * API key configured (a Floor billing a subscription token), on any status other
 * than a credit-shaped 429/403, and on any network error. The worst case is
 * un-parking a run that then fails and re-trips the gate five minutes later; the
 * opposite bias would wedge the whole factory on a flaky probe.
 */
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

/** How far back the orphan report looks. Matches this handler's hourly tick, so
 *  consecutive runs neither skip a window nor re-report the same events. */
const ORPHAN_WINDOW_MINUTES = 60;

/** Housekeeping: drop old terminal event rows so the claim index stays small, and
 *  reap agent run events past the 14-day retention horizon (FR1.13). */
export const eventsPrune: EventHandler = async () => {
  const n = await pruneHandled(7);

  if (n > 0) {
    console.log(`[events] pruned ${n} handled delivery(ies)`);
  }

  // The failure the delivery model introduces: an event name nobody subscribed
  // to used to be a LOUD dead-letter and is now silence — no deliveries, no
  // handler, no row anyone looks at. Reporting it is what keeps a producer whose
  // consumer was never deployed from failing invisibly.
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
