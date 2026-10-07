// Binds the implementation loop's backlog tick to the ports this process holds (composition root).
import { tickPortsOf } from "@re-cinq/lore-shared/backlog/driver-ports.js";
import {
  openFloorLoopRun,
  startTicketOnFloor,
  type FloorTicketDeps,
} from "@re-cinq/lore-shared/backlog/floor-loop.js";
import {
  createImplementationLoopTickHandler,
  type LoopTickDeps,
} from "@re-cinq/lore-shared/backlog/implementation-loop-tick.js";
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { ensureBranch } from "@re-cinq/lore-shared/project/repo/ensure-branch.js";
import { projectFor } from "../../outbound/project-boot.js";
import { pipeline, settings, taskStore } from "../../outbound/queues.js";

export const NO_FLOOR =
  "no external floor configured: the Floor walks the loop";

export async function runLoopTick(
  params: Readonly<Record<string, unknown>>,
): Promise<string> {
  if (!floorConfigured()) {
    return NO_FLOOR;
  }
  await createImplementationLoopTickHandler(tickDeps())({ ...params });

  return "ticked";
}

function tickDeps(): LoopTickDeps {
  return {
    ...tickPortsOf({
      settings: settings(),
      taskQueue: pipeline().taskQueue,
      tasks: taskStore(),
      projectOf: projectFor,
    }),
    findOpenBySubject: openRunOf,
    started: (ticket) => startTicketOnFloor(floorTicketDeps(), ticket),
  };
}

/** A repository is busy while either engine holds a loop run for it: a run Lore's own Floor started before the cutover finishes there, and no second ticket starts beside it. */
async function openRunOf(
  repo: string,
  subjectKey: string,
): Promise<{ id: string } | null> {
  return (
    (await pipeline().assemblyRuns.findOpenBySubject(repo, subjectKey)) ??
    (await openFloorLoopRun(floorClient(), repo))
  );
}

function floorTicketDeps(): FloorTicketDeps {
  return {
    floor: floorClient(),
    claim: (taskId) => moveTask(taskId, { from: "pending", to: "running" }),
    ensureBranch: async (repo, branch) =>
      ensureBranch((await projectFor(repo)).repo, branch),
    failTask: async (taskId, reason) => {
      await moveTask(taskId, { from: "running", to: "failed", reason });
    },
  };
}

interface TaskMove {
  from: string;
  to: string;
  reason?: string;
}

/** A compare-and-set, with the transition recorded only by whoever won it. */
async function moveTask(taskId: string, move: TaskMove): Promise<boolean> {
  const { from, to, reason } = move;
  const won = await taskStore().setStatusIf(
    taskId,
    from,
    to,
    reason ? { failure_reason: reason } : {},
  );

  if (won) {
    await taskStore().recordEvent(taskId, from, to, {
      runner: "floor",
      ...(reason ? { error: reason } : {}),
    });
  }

  return won;
}
