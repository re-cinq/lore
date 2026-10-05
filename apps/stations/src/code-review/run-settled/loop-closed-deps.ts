// Binds the loop's settling rules to the ports this process holds (composition root).
import { ticketPortsOf } from "@re-cinq/lore-shared/backlog/driver-ports.js";
import { infraDeferralsFromEnv } from "@re-cinq/lore-shared/backlog/loop-infra-deferral.js";
import type { LoopRunClosedDeps } from "@re-cinq/lore-shared/backlog/loop-run-closed.js";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { projectFor } from "../../outbound/project-boot.js";
import { eventProxy, pipeline, taskStore } from "../../outbound/queues.js";
import {
  floorInfraFailures,
  type FloorLoopRun,
  type SettleLoopDeps,
} from "./loop-closed.js";

export const loopClosedDeps: SettleLoopDeps = {
  run: async (runId) => (await floorClient().runs.get(runId))?.run ?? null,
  visits: (runId) => floorClient().stationRuns.list({ run: runId }),
  closed: closedDepsFor,
};

function closedDepsFor(settled: FloorLoopRun): LoopRunClosedDeps {
  return {
    getTaskIssueNumber: taskIssueNumber,
    recordWhy: (taskId, why) =>
      pipeline().taskQueue.setColumns(taskId, { failure_reason: why }),
    listStationRuns: () => Promise.resolve(settled.visits),
    priorInfraFailures: (repo, branch, since, excludeRunId) =>
      floorInfraFailures(floorClient(), {
        repo,
        branch,
        since,
        excludeRunId,
      }),
    maxInfraDeferrals: infraDeferralsFromEnv(process.env),
    ...ticketPortsOf(projectFor),
    emitTick: queueLoopTick,
  };
}

async function taskIssueNumber(taskId: string): Promise<number | null> {
  const task = await taskStore().getById(taskId);
  const issueNumber = Number(
    (task as { issue_number?: unknown } | null)?.issue_number,
  );

  return issueNumber > 0 ? issueNumber : null;
}

/** Queued rather than inserted, so a router blip costs a late tick and not a lost one: the next ticket starts in seconds, not at the next safety tick. */
function queueLoopTick(repo: string): Promise<void> {
  return eventProxy().emit({
    kind: "event",
    event: {
      eventName: "cron.implementation_loop.tick",
      source: "internal",
      params: { repo },
    },
  });
}
