/**
 * Layer-3 handlers for `cron.*.tick` events. The in-process scheduler no longer
 * runs these jobs directly — it emits a tick event and the loop dispatches here.
 * These are the light/operational jobs that are safe to run in the Floor pod;
 * heavy batch jobs (reindex/eval/gap-detect …) are handled separately.
 */

import { mergeCheckJob } from "./merge/merge-check.js";
import { approvalCheckJob } from "./dark-factory/approval-check.js";
import { specTaskExecutorJob } from "./task/spec-task-executor.js";
import { staleTaskCheckJob } from "./task/stale-task-check.js";
import { featurePlanningReaperJob } from "./task/feature-planning-reaper.js";
import { leaseReaperJob } from "../main-loop/lease/lease-reaper.js";
import { pruneHandled } from "../main-loop/store.js";
import { agentRunEvents, agentRunTurns } from "../kernel/queues.js";
import { reconcileAgents } from "../listeners/k8s-watch.js";
import type { EventHandler } from "../main-loop/types.js";

/** Agent run events are per-tool-call telemetry: high volume, low half-life. */
const AGENT_RUN_EVENT_RETENTION_DAYS = 14;

/** Turns are the full-fidelity transcript: kept longer than the projection's 14
 *  days because the store exists precisely for questions asked after the live
 *  view has moved on, but deliberately conservative. There is no pilot and so no
 *  growth measurement to justify a longer horizon; 30 days is the starting bet
 *  and the prune's log line is the only growth signal until one exists. */
const AGENT_RUN_TURN_RETENTION_DAYS = 30;

/** Adapt an existing `() => Promise<string>` job into an event handler (drop the summary). */
const fromJob =
  (job: () => Promise<string>): EventHandler =>
  async () => {
    await job();
  };

export const mergeCheck = fromJob(mergeCheckJob);
export const approvalCheck = fromJob(approvalCheckJob);
export const specTaskExecutor = fromJob(specTaskExecutorJob);
export const staleTaskCheck = fromJob(staleTaskCheckJob);
export const featurePlanningReaper = fromJob(featurePlanningReaperJob);

/** Delete leases >5min past expiry, writing a `lease_expired` audit entry per row. */
export const leaseReaper = fromJob(() => leaseReaperJob());

/** The event-driven walk's liveness bound: resolve dropped node-terminal events,
 *  relaunch rowed-but-unlaunched CRs, time out stuck nodes, fail wedged rows. */
export const assemblyLineReaper: EventHandler = async () => {
  const [
    { assemblyLineReaperJob },
    { productionNodeEventDeps },
    { taskStore },
  ] = await Promise.all([
    import("./assembly-line/assembly-line-reaper.js"),
    import("./assembly-line/node-event-handler.js"),
    import("../kernel/queues.js"),
  ]);
  const summary = await assemblyLineReaperJob({
    ...(await productionNodeEventDeps()),
    taskStatus: async (taskId) =>
      (await taskStore().getById(taskId))?.status ?? null,
  });

  if (!summary.startsWith("resolved 0, relaunched 0, timed out 0")) {
    console.log(`[assembly-line-reaper] ${summary}`);
  }
};

/** Housekeeping: drop old terminal event rows so the claim index stays small, and
 *  reap agent run events past the 14-day retention horizon (FR1.13). */
export const eventsPrune: EventHandler = async () => {
  const n = await pruneHandled(7);

  if (n > 0) {
    console.log(`[events] pruned ${n} handled event(s)`);
  }

  const runEvents = await agentRunEvents().pruneOld(
    AGENT_RUN_EVENT_RETENTION_DAYS,
  );

  if (runEvents > 0) {
    console.log(`[events] pruned ${runEvents} agent run event(s)`);
  }

  const runTurns = await agentRunTurns().pruneOld(
    AGENT_RUN_TURN_RETENTION_DAYS,
  );

  if (runTurns > 0) {
    console.log(`[events] pruned ${runTurns} agent run turn(s)`);
  }
};

/** Safety net for dropped k8s watch events: re-emit for terminal-unhandled CRs + prune old ones. */
export const agentWatcherReconcile: EventHandler = async () => {
  await reconcileAgents();
};
