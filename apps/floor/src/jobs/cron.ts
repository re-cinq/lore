/**
 * Layer-3 handlers for `cron.*.tick` events. The in-process scheduler no longer
 * runs these jobs directly — it emits a tick event and the loop dispatches here.
 * These are the light/operational jobs that are safe to run in the Floor pod;
 * heavy batch jobs (reindex/eval/gap-detect …) are handled separately.
 */

import { mergeCheckJob } from "./merge/merge-check.js";
import { approvalCheckJob } from "./dark-factory/approval-check.js";
import { reviewReactorJob } from "./review/review-reactor.js";
import { specTaskExecutorJob } from "./task/spec-task-executor.js";
import { staleTaskCheckJob } from "./task/stale-task-check.js";
import { featurePlanningReaperJob } from "./task/feature-planning-reaper.js";
import { leaseReaperJob } from "../main-loop/lease/lease-reaper.js";
import { pruneHandled } from "../main-loop/store.js";
import { reconcileAgents } from "../listeners/k8s-watch.js";
import type { EventHandler } from "../main-loop/types.js";

/** Adapt an existing `() => Promise<string>` job into an event handler (drop the summary). */
const fromJob =
  (job: () => Promise<string>): EventHandler =>
  async () => {
    await job();
  };

export const mergeCheck = fromJob(mergeCheckJob);
export const approvalCheck = fromJob(approvalCheckJob);
export const reviewReactorCron = fromJob(reviewReactorJob);
export const specTaskExecutor = fromJob(specTaskExecutorJob);
export const staleTaskCheck = fromJob(staleTaskCheckJob);
export const featurePlanningReaper = fromJob(featurePlanningReaperJob);

/** Delete leases >5min past expiry, writing a `lease_expired` audit entry per row. */
export const leaseReaper = fromJob(() => leaseReaperJob());

/** The event-driven walk's liveness bound: resolve dropped node-terminal events,
 *  relaunch rowed-but-unlaunched CRs, time out stuck nodes, fail wedged rows. */
export const assemblyLineReaper: EventHandler = async () => {
  const [{ assemblyLineReaperJob }, { productionNodeEventDeps }] =
    await Promise.all([
      import("./assembly-line/assembly-line-reaper.js"),
      import("./assembly-line/node-event-handler.js"),
    ]);
  const summary = await assemblyLineReaperJob(await productionNodeEventDeps());

  if (!summary.startsWith("resolved 0, relaunched 0, timed out 0")) {
    console.log(`[assembly-line-reaper] ${summary}`);
  }
};

/** Housekeeping: drop old terminal event rows so the claim index stays small. */
export const eventsPrune: EventHandler = async () => {
  const n = await pruneHandled(7);

  if (n > 0) {
    console.log(`[events] pruned ${n} handled event(s)`);
  }
};

/** Safety net for dropped k8s watch events: re-emit for terminal-unhandled CRs + prune old ones. */
export const agentWatcherReconcile: EventHandler = async () => {
  await reconcileAgents();
};
