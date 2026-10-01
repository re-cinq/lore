// The implementation loop's terminal hook bound to this process: what a run Lore's own Floor walked owes its ticket when it ends.
import type { EventProxy } from "@re-cinq/lore-shared/project/events/event-proxy.js";
import { ticketPortsOf } from "@re-cinq/lore-shared/backlog/driver-ports.js";
import {
  countInfraFailures,
  infraDeferralsFromEnv,
} from "@re-cinq/lore-shared/backlog/loop-infra-deferral.js";
import {
  handleLoopRunClosed,
  type ClosedLoopRun,
  type LoopRunClosedDeps,
} from "@re-cinq/lore-shared/backlog/loop-run-closed.js";

/** Production hook for finishLine's onRunClosed seam. */
export async function loopRunClosed(
  run: ClosedLoopRun,
  outcome: string,
  reason: string | undefined,
): Promise<void> {
  const [queues, { projectFor }] = await Promise.all([
    import("../../outbound/queues.js"),
    import("../../outbound/project-boot.js"),
  ]);

  await handleLoopRunClosed(
    run,
    outcome,
    reason,
    productionDeps(queues, projectFor),
  );
}

type LoopQueues = typeof import("../../outbound/queues.js");
type ProjectForFn =
  (typeof import("../../outbound/project-boot.js"))["projectFor"];

function productionDeps(
  queues: LoopQueues,
  projectFor: ProjectForFn,
): LoopRunClosedDeps {
  const { pipeline, taskStore, eventProxy } = queues;

  return {
    getTaskIssueNumber: (taskId) => taskIssueNumber(taskStore, taskId),
    listStationRuns: (runId) => pipeline().assemblyRuns.listStationRuns(runId),
    ...deferralDeps(pipeline),
    ...ticketPortsOf(projectFor),
    emitTick: (repo) => queueLoopTick(repo, eventProxy),
  };
}

/** QUEUED rather than inserted: `onRunClosed` swallows what this throws, so a router blip used to lose the tick until the cron emitter next came round. The proxy retries it instead. */
function queueLoopTick(
  repo: string,
  eventProxy: () => EventProxy,
): Promise<void> {
  return eventProxy().emit({
    kind: "event",
    event: {
      eventName: "cron.implementation_loop.tick",
      source: "internal",
      params: { repo },
    },
  });
}

async function taskIssueNumber(
  taskStore: LoopQueues["taskStore"],
  taskId: string,
): Promise<number | null> {
  const task = await taskStore().getById(taskId);
  const n = Number((task as { issue_number?: unknown } | null)?.issue_number);

  return n > 0 ? n : null;
}

/** The deferral half of the hook's dependencies: the branch's earlier infrastructure failures, and the bound. */
function deferralDeps(
  pipeline: LoopQueues["pipeline"],
): Pick<LoopRunClosedDeps, "priorInfraFailures" | "maxInfraDeferrals"> {
  return {
    priorInfraFailures: (repo, branch, since, excludeRunId) =>
      countInfraFailures(pipeline().assemblyRuns, {
        repo,
        branch,
        since,
        excludeRunId,
      }),
    maxInfraDeferrals: infraDeferralsFromEnv(process.env),
  };
}
