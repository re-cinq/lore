import { floorIfConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { hasOpenFloorRunForTask } from "@re-cinq/lore-shared/floor/floor-task-runs.js";
import { pipeline } from "../../outbound/queues.js";

/** True while a task's work is still in flight: an assembly run of it queued or running here, or a run the external floor holds open for it. A task the floor runs has no row here at all, so without the second read it would look abandoned from its first minute. */
export async function taskHasOpenLine(taskId: string): Promise<boolean> {
  const lines = await pipeline().assemblyRuns.listForTask(taskId);

  return (
    lines.some(
      (line) => line.status === "running" || line.status === "queued",
    ) || hasOpenFloorRunForTask(floorIfConfigured(), taskId)
  );
}
