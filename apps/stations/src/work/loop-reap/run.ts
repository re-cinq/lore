// Binds the stuck-running-task reap to the ports this process holds (composition root).
import { ticketPortsOf } from "@re-cinq/lore-shared/backlog/driver-ports.js";
import {
  reapRetriesFromEnv,
  reapStuckLoopTasks,
  type LoopReapDeps,
} from "@re-cinq/lore-shared/backlog/loop-reap.js";
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { projectFor } from "../../outbound/project-boot.js";
import { taskStore } from "../../outbound/queues.js";

export const NO_FLOOR = "no external floor configured: nothing to reap";

export async function runLoopReap(): Promise<string> {
  if (!floorConfigured()) {
    return NO_FLOOR;
  }

  return reapStuckLoopTasks(reapDeps());
}

function reapDeps(): LoopReapDeps {
  const { addLabel, comment } = ticketPortsOf(projectFor);

  return {
    floor: floorClient(),
    tasks: taskStore(),
    addLabel,
    comment,
    maxRetries: reapRetriesFromEnv(process.env),
  };
}
