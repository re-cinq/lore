// Whether the external floor is still working on a task. A line that keeps a `pipeline.tasks` row keys its run on the task (`task_id` is the line's subject), so the row's keepers can ask before deciding the task is stuck.
import type { FloorClient, Item, RunView } from "@re-cinq/floor-client";

export interface TaskRunsFloor {
  runs: Pick<FloorClient["runs"], "list">;
}

export function floorTaskSubject(taskId: string): string {
  return `task_id:${taskId}`;
}

/** Lines that keep a task but key their run on something else: the implementation loop keys on the repository's backlog, so one ticket runs at a time. Their runs are found by the task they were started with. */
const LINES_KEYED_OTHERWISE: readonly string[] = ["implementation-loop"];

/** False on a deployment with no floor: nothing runs there. */
export async function hasOpenFloorRunForTask(
  floor: TaskRunsFloor | null,
  taskId: string,
): Promise<boolean> {
  if (!floor) {
    return false;
  }
  const [keyed, ...others] = await Promise.all([
    floor.runs.list({ subject: floorTaskSubject(taskId), open: true }),
    ...LINES_KEYED_OTHERWISE.map((line) =>
      floor.runs.list({ line, open: true }),
    ),
  ]);
  const startedWithTask = others
    .flatMap(({ items: openRuns }) => openRuns)
    .filter((run) => taskOf(run) === taskId);

  return keyed.items.length > 0 || startedWithTask.length > 0;
}

function taskOf(run: RunView): string | undefined {
  const startItems: Partial<Record<string, Item>> = run.startItems;

  return startItems.task_id?.ref;
}
