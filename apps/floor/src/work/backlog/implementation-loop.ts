// Lore's own Floor as the driver of the implementation loop (specs/implementation-loop FR2): the tick's ports bound to this process. Where an external floor is configured the stations service runs the tick instead and this handler stands down, so one engine picks a repository's next ticket, never both.
import { tickPortsOf } from "@re-cinq/lore-shared/backlog/driver-ports.js";
import {
  createImplementationLoopTickHandler,
  type LoopTickDeps,
} from "@re-cinq/lore-shared/backlog/implementation-loop-tick.js";
import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import type { EventHandler } from "../../domain/event-types.js";

/** Production wiring for the `cron.implementation_loop.tick` handler. */
export const implementationLoopTick: EventHandler = async (params) => {
  if (floorConfigured()) {
    return;
  }
  const handler = createImplementationLoopTickHandler(await tickDeps());

  await handler(params);
};

/** Imported per call, never at module load: the queues need an initialized pool. */
async function tickDeps(): Promise<LoopTickDeps> {
  const [{ pipeline, settings, taskStore }, { projectFor }] = await Promise.all(
    [
      import("../../outbound/queues.js"),
      import("../../outbound/project-boot.js"),
    ],
  );

  return {
    ...tickPortsOf({
      settings: settings(),
      taskQueue: pipeline().taskQueue,
      tasks: taskStore(),
      projectOf: projectFor,
    }),
    findOpenBySubject: (repo, key) =>
      pipeline().assemblyRuns.findOpenBySubject(repo, key),
    // The worker claims the pending task; nothing to start here.
    started: () => Promise.resolve(),
  };
}
