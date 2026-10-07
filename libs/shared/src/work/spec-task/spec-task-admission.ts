// Which ready spec-tasks may start now, beside what their groups already run. Pure. Two tasks of one group never run together when either is not parallelizable (tasks.md's missing `[P]`) or both edit the same file: the issue-triage plan's eight tasks on one YAML ran three at a time and opened PRs that could only conflict (2026-09-29).

import type {
  ReadySpecTask,
  RunningSpecTask,
} from "../../outbound/project/tasks/task-queue-port.js";

const MAX_CONCURRENT_PER_GROUP = 3;

/** The ready tasks to dispatch this tick, in the order given; each one admitted counts against its group for the ones after it. */
export function admitSpecTasks(
  ready: readonly ReadySpecTask[],
  running: readonly RunningSpecTask[],
): ReadySpecTask[] {
  const occupied = [...running];

  return ready.filter((task) => {
    const candidate = asRunning(task);

    if (!candidate) {
      return true;
    }
    const fits = fitsBeside(candidate, occupied);

    if (fits) {
      occupied.push(candidate);
    }

    return fits;
  });
}

// A task with no group has no siblings to collide with.
function asRunning(task: ReadySpecTask): RunningSpecTask | null {
  if (!task.task_group_id) {
    return null;
  }
  const bundle = task.context_bundle ?? {};

  return {
    task_group_id: task.task_group_id,
    file_path: typeof bundle.file_path === "string" ? bundle.file_path : null,
    parallelizable: bundle.parallelizable === true,
  };
}

function fitsBeside(
  candidate: RunningSpecTask,
  occupied: readonly RunningSpecTask[],
): boolean {
  const siblings = occupied.filter(
    (other) => other.task_group_id === candidate.task_group_id,
  );

  return (
    siblings.length < MAX_CONCURRENT_PER_GROUP &&
    siblings.every((sibling) => !conflicts(candidate, sibling))
  );
}

function conflicts(a: RunningSpecTask, b: RunningSpecTask): boolean {
  return (
    !a.parallelizable ||
    !b.parallelizable ||
    (a.file_path !== null && a.file_path === b.file_path)
  );
}
