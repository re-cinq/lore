// Whether the external floor is still working on a task. A line that keeps a `pipeline.tasks` row keys its run on the task (`task_id` is the line's subject), so the row's keepers can ask before deciding the task is stuck.
import type { FloorClient } from "@re-cinq/floor-client";

export interface TaskRunsFloor {
  runs: Pick<FloorClient["runs"], "list">;
}

export function floorTaskSubject(taskId: string): string {
  return `task_id:${taskId}`;
}

/** False on a deployment with no floor: nothing runs there. */
export async function hasOpenFloorRunForTask(
  floor: TaskRunsFloor | null,
  taskId: string,
): Promise<boolean> {
  if (!floor) {
    return false;
  }
  const { items } = await floor.runs.list({
    subject: floorTaskSubject(taskId),
    open: true,
  });

  return items.length > 0;
}
